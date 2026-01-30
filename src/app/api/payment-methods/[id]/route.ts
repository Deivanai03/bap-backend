import { NextRequest } from 'next/server';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { payment_methods } from '../../../../lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;
  const paymentMethodId = params.id;

  try {
    // Get payment method to verify ownership and existence
    const [paymentMethod] = await db
      .select({
        id: payment_methods.id,
        card_brand: payment_methods.card_brand,
        card_last4: payment_methods.card_last4,
      })
      .from(payment_methods)
      .where(
        and(
          eq(payment_methods.id, paymentMethodId),
          eq(payment_methods.org_id, user.org_id),
          isNull(payment_methods.deleted_at)
        )
      )
      .limit(1);

    if (!paymentMethod) {
      return createErrorResponse('Payment method not found', 404);
    }

    // Soft delete the payment method
    await db
      .update(payment_methods)
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(payment_methods.id, paymentMethodId));

    return createApiResponse({
      message: 'Payment method deleted successfully'
    });

  } catch (error: any) {
    console.error('Error deleting payment method:', error);
    return createErrorResponse('Failed to delete payment method', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
