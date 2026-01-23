import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { payment_methods } from '../../../../lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/payment-methods/{id}:
 *   delete:
 *     summary: Delete payment method
 *     description: Remove a payment method from the organization
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment method ID
 *     responses:
 *       200:
 *         description: Payment method deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment method not found
 *       429:
 *         description: Rate limit exceeded
 */
async function deletePaymentMethod(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Extract payment method ID from URL path
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(segment => segment !== '');
    // Path: /api/payment-methods/[id] -> segments: ['api', 'payment-methods', 'id']
    const paymentMethodId = pathSegments[2];

    // Validate payment method ID format (UUID or Stripe PM ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const stripeRegex = /^pm_[a-zA-Z0-9]+$/;
    if (!paymentMethodId || (!uuidRegex.test(paymentMethodId) && !stripeRegex.test(paymentMethodId))) {
      return createErrorResponse('Invalid payment method ID format', 400);
    }

    // Get payment method to verify ownership and existence
    const isUUID = uuidRegex.test(paymentMethodId);
    
    const paymentMethod = await db
      .select({
        id: payment_methods.id,
        type: payment_methods.type,
        card_brand: payment_methods.card_brand,
        card_last4: payment_methods.card_last4,
        is_default: payment_methods.is_default,
        org_id: payment_methods.org_id
      })
      .from(payment_methods)
      .where(
        and(
          isUUID 
            ? eq(payment_methods.id, paymentMethodId)
            : eq(payment_methods.stripe_payment_method_id, paymentMethodId),
          eq(payment_methods.org_id, request.user.org_id),
          isNull(payment_methods.deleted_at)
        )
      )
      .limit(1);

    if (!paymentMethod.length) {
      return createErrorResponse('Payment method not found', 404);
    }

    const paymentMethodData = paymentMethod[0];

    // Check if this is the only payment method
    const totalPaymentMethods = await db
      .select({ count: payment_methods.id })
      .from(payment_methods)
      .where(
        and(
          eq(payment_methods.org_id, request.user.org_id),
          isNull(payment_methods.deleted_at)
        )
      );

    if (totalPaymentMethods.length <= 1) {
      return createErrorResponse('Cannot delete the last payment method', 400);
    }

    // Soft delete the payment method
    const deletedPaymentMethod = await db
      .update(payment_methods)
      .set({
        deleted_at: new Date(),
        is_default: false, // Remove default status when deleting
        updated_at: new Date(),
      })
      .where(
        isUUID 
          ? eq(payment_methods.id, paymentMethodId)
          : eq(payment_methods.stripe_payment_method_id, paymentMethodId)
      )
      .returning();

    // If this was the default payment method, set another one as default
    if (paymentMethodData.is_default) {
      const remainingPaymentMethods = await db
        .select()
        .from(payment_methods)
        .where(
          and(
            eq(payment_methods.org_id, request.user.org_id),
            isNull(payment_methods.deleted_at)
          )
        )
        .limit(1);

      if (remainingPaymentMethods.length > 0) {
        await db
          .update(payment_methods)
          .set({ is_default: true })
          .where(eq(payment_methods.id, remainingPaymentMethods[0].id));
      }
    }

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'payment_method.deleted',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'payment_method',
      resource_id: paymentMethodData.id,
      action: 'delete',
      description: `User deleted payment method (${paymentMethodData.card_brand} ****${paymentMethodData.card_last4})`,
      metadata: { 
        payment_method_type: paymentMethodData.type,
        card_brand: paymentMethodData.card_brand,
        card_last4: paymentMethodData.card_last4,
        was_default: paymentMethodData.is_default
      },
      request
    });

    return createApiResponse({
      message: 'Payment method deleted successfully',
      deleted_payment_method: {
        id: paymentMethodData.id,
        type: paymentMethodData.type,
        card_brand: paymentMethodData.card_brand,
        card_last4: paymentMethodData.card_last4
      }
    });

  } catch (error) {
    console.error('Error deleting payment method:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const DELETE = withAuth(deletePaymentMethod);
