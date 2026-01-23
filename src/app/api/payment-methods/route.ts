import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { subscriptions, payment_methods } from '../../../lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { logAuditEvent } from '../../../lib/audit/logger';
import { apiRateLimit } from '../../../lib/rate-limit';
import { getPaymentMethods as getStripePaymentMethods, stripe } from '../../../lib/stripe';
import { z } from 'zod';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/payment-methods:
 *   get:
 *     summary: Get payment methods
 *     description: Retrieve organization's saved payment methods
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payment methods
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 *   post:
 *     summary: Add payment method
 *     description: Add a new payment method to the organization
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stripe_payment_method_id
 *             properties:
 *               stripe_payment_method_id:
 *                 type: string
 *                 example: pm_1234567890abcdef
 *                 description: Stripe payment method ID
 *               set_as_default:
 *                 type: boolean
 *                 default: false
 *                 description: Set this payment method as default
 *     responses:
 *       200:
 *         description: Payment method added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Payment method already exists
 *       429:
 *         description: Rate limit exceeded
 */

// Define schema inline
const AddPaymentMethodSchema = z.object({
  stripe_payment_method_id: z.string().min(1, 'Stripe payment method ID is required'),
  set_as_default: z.boolean().optional().default(false),
});

async function getPaymentMethods(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Get organization's Stripe customer ID from subscription
    const subscription = await db
      .select({ stripe_customer_id: subscriptions.stripe_customer_id })
      .from(subscriptions)
      .where(eq(subscriptions.org_id, request.user.org_id))
      .limit(1);

    if (!subscription[0]?.stripe_customer_id) {
      return createApiResponse([]);
    }

    // Get payment methods from Stripe
    const stripePaymentMethods = await getStripePaymentMethods(subscription[0].stripe_customer_id);
    
    if (!stripePaymentMethods) {
      return createErrorResponse('Failed to fetch payment methods', 500);
    }

    const paymentMethodsList = stripePaymentMethods.data.map(pm => ({
      id: pm.id,
      type: pm.type,
      card_brand: pm.card?.brand || null,
      card_last4: pm.card?.last4 || null,
      card_exp_month: pm.card?.exp_month || null,
      card_exp_year: pm.card?.exp_year || null,
      bank_name: pm.us_bank_account?.bank_name || null,
      bank_last4: pm.us_bank_account?.last4 || null,
      is_default: false,
      is_verified: true,
      created_at: new Date(pm.created * 1000)
    }));

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'payment_methods.viewed',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'payment_methods',
      action: 'list',
      description: `User viewed payment methods list (${paymentMethodsList.length} methods)`,
      metadata: { 
        payment_methods_count: paymentMethodsList.length,
        has_default: paymentMethodsList.some(pm => pm.is_default)
      },
      request
    });

    return createApiResponse({
      payment_methods: paymentMethodsList,
      count: paymentMethodsList.length
    });

  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

async function addPaymentMethod(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = AddPaymentMethodSchema.safeParse(body);
    
    if (!validation.success) {
      return createErrorResponse(
        `Invalid request: ${validation.error.issues.map(e => e.message).join(', ')}`,
        400
      );
    }

    const { stripe_payment_method_id, set_as_default } = validation.data;

    // Check if payment method already exists
    const existingPaymentMethod = await db
      .select()
      .from(payment_methods)
      .where(
        and(
          eq(payment_methods.stripe_payment_method_id, stripe_payment_method_id),
          isNull(payment_methods.deleted_at)
        )
      )
      .limit(1);

    if (existingPaymentMethod.length > 0) {
      return createErrorResponse('Payment method already exists', 409);
    }

    // Get organization's Stripe customer ID from subscription
    const subscription = await db
      .select({ stripe_customer_id: subscriptions.stripe_customer_id })
      .from(subscriptions)
      .where(eq(subscriptions.org_id, request.user.org_id))
      .limit(1);

    if (!subscription[0]?.stripe_customer_id) {
      return createErrorResponse('No Stripe customer found for organization', 400);
    }

    // Validate payment method with Stripe
    let stripePaymentMethod;
    try {
      stripePaymentMethod = await stripe.paymentMethods.retrieve(stripe_payment_method_id);
    } catch (error: any) {
      console.error('Stripe payment method validation error:', error);
      
      if (error.type === 'StripeInvalidRequestError') {
        return createErrorResponse('Invalid payment method ID', 400);
      }
      
      return createErrorResponse('Failed to validate payment method', 500);
    }

    // Attach payment method to customer if not already attached
    if (!stripePaymentMethod.customer) {
      try {
        await stripe.paymentMethods.attach(stripe_payment_method_id, {
          customer: subscription[0].stripe_customer_id,
        });
      } catch (error: any) {
        console.error('Error attaching payment method to customer:', error);
        
        // Handle specific Stripe errors
        if (error.type === 'StripeCardError') {
          const errorMessages: { [key: string]: string } = {
            'card_declined': 'Your card was declined. Please try a different payment method.',
            'insufficient_funds': 'Your card has insufficient funds. Please try a different payment method.',
            'expired_card': 'Your card has expired. Please try a different payment method.',
            'incorrect_cvc': 'Your card\'s security code is incorrect. Please try again.',
            'processing_error': 'An error occurred while processing your card. Please try again.',
            'incorrect_number': 'Your card number is incorrect. Please try again.'
          };
          
          const userMessage = errorMessages[error.code] || error.message || 'Your payment method was declined. Please try a different payment method.';
          return createErrorResponse(userMessage, 402);
        }
        
        return createErrorResponse('Failed to attach payment method', 500);
      }
    }

    const newPaymentMethod = await db.transaction(async (tx) => {
      // If set_as_default, unset other default payment methods
      if (set_as_default) {
        await tx
          .update(payment_methods)
          .set({ is_default: false })
          .where(
            and(
              eq(payment_methods.org_id, request.user.org_id),
              isNull(payment_methods.deleted_at)
            )
          );
      }

      // Insert new payment method
      const result = await tx
        .insert(payment_methods)
        .values({
          org_id: request.user.org_id,
          user_id: request.user.user_id,
          stripe_payment_method_id: stripe_payment_method_id,
          type: stripePaymentMethod.type as any,
          card_brand: stripePaymentMethod.card?.brand || null,
          card_last4: stripePaymentMethod.card?.last4 || null,
          card_exp_month: stripePaymentMethod.card?.exp_month || null,
          card_exp_year: stripePaymentMethod.card?.exp_year || null,
          bank_name: stripePaymentMethod.us_bank_account?.bank_name || null,
          bank_last4: stripePaymentMethod.us_bank_account?.last4 || null,
          is_default: set_as_default,
          is_verified: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      return result[0];
    });

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'payment_method.added',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'payment_method',
      resource_id: newPaymentMethod.id,
      action: 'create',
      description: `User added new payment method (${stripePaymentMethod.card?.brand || stripePaymentMethod.type} ****${stripePaymentMethod.card?.last4 || stripePaymentMethod.us_bank_account?.last4})`,
      metadata: { 
        stripe_payment_method_id,
        payment_method_type: stripePaymentMethod.type,
        card_brand: stripePaymentMethod.card?.brand,
        card_last4: stripePaymentMethod.card?.last4,
        bank_name: stripePaymentMethod.us_bank_account?.bank_name,
        bank_last4: stripePaymentMethod.us_bank_account?.last4,
        set_as_default
      },
      request
    });

    return createApiResponse({
      payment_method: {
        id: newPaymentMethod.id,
        type: newPaymentMethod.type,
        card_brand: newPaymentMethod.card_brand,
        card_last4: newPaymentMethod.card_last4,
        card_exp_month: newPaymentMethod.card_exp_month,
        card_exp_year: newPaymentMethod.card_exp_year,
        is_default: newPaymentMethod.is_default,
        is_verified: newPaymentMethod.is_verified,
        created_at: newPaymentMethod.created_at
      },
      message: `Payment method added successfully${set_as_default ? ' and set as default' : ''}`
    });

  } catch (error) {
    console.error('Error adding payment method:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(getPaymentMethods);
export const POST = withAuth(addPaymentMethod);
