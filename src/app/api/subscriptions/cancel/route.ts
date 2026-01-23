import { db } from '../../../../lib/db';
import { subscriptions, plans } from '../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { cancelSubscription as cancelStripeSubscription } from '../../../../lib/stripe';
import { z } from 'zod';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/subscriptions/cancel:
 *   post:
 *     summary: Cancel subscription
 *     description: Cancel the organization's current subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cancel_at_period_end:
 *                 type: boolean
 *                 default: true
 *                 description: Cancel at the end of current billing period
 *               reason:
 *                 type: string
 *                 example: Switching to competitor
 *               feedback:
 *                 type: string
 *                 example: Missing required features
 *     responses:
 *       200:
 *         description: Subscription cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Active subscription not found
 *       429:
 *         description: Rate limit exceeded
 */

// Define schema inline
const CancelSubscriptionSchema = z.object({
  cancel_at_period_end: z.boolean(),
  reason: z.string().optional(),
  feedback: z.string().optional(),
});

async function cancelSubscription(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = CancelSubscriptionSchema.safeParse(body);
    
    if (!validation.success) {
      return createErrorResponse(
        `Invalid request: ${validation.error.issues.map(e => e.message).join(', ')}`,
        400
      );
    }

    const { cancel_at_period_end, reason, feedback } = validation.data;

    // Get current subscription
    const currentSubscription = await db
      .select({
        subscription: subscriptions,
        plan: plans
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.plan_id, plans.id))
      .where(
        and(
          eq(subscriptions.org_id, request.user.org_id),
          eq(subscriptions.status, 'active')
        )
      )
      .limit(1);

    if (!currentSubscription.length) {
      return createErrorResponse('No active subscription found', 404);
    }

    const { subscription: currentSub, plan } = currentSubscription[0];

    // Check if already scheduled for cancellation
    if (currentSub.cancel_at_period_end && cancel_at_period_end) {
      return createErrorResponse('Subscription is already scheduled for cancellation', 400);
    }

    // Update subscription
    const cancelledAt = cancel_at_period_end ? null : new Date();
    const newStatus = cancel_at_period_end ? 'active' : 'canceled';

    const updatedSubscription = await db
      .update(subscriptions)
      .set({
        cancel_at_period_end: cancel_at_period_end,
        canceled_at: cancelledAt,
        cancellation_reason: reason || null,
        status: newStatus,
        updated_at: new Date(),
      })
      .where(eq(subscriptions.id, currentSub.id))
      .returning();

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: cancel_at_period_end ? 'subscription.scheduled_cancellation' : 'subscription.canceled',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'subscription',
      resource_id: currentSub.id,
      action: 'cancel',
      description: cancel_at_period_end 
        ? `Subscription scheduled for cancellation at period end (${currentSub.current_period_end})`
        : 'Subscription canceled immediately',
      changes: {
        from: {
          status: currentSub.status,
          cancel_at_period_end: currentSub.cancel_at_period_end,
          canceled_at: currentSub.canceled_at
        },
        to: {
          status: newStatus,
          cancel_at_period_end: cancel_at_period_end,
          canceled_at: cancelledAt
        }
      },
      metadata: { 
        plan_name: plan.name,
        plan_tier: plan.tier,
        reason,
        feedback,
        cancellation_type: cancel_at_period_end ? 'end_of_period' : 'immediate'
      },
      request
    });

    const responseMessage = cancel_at_period_end
      ? `Subscription will be canceled at the end of the current billing period (${currentSub.current_period_end})`
      : 'Subscription canceled immediately';

    return createApiResponse({
      subscription: {
        id: updatedSubscription[0].id,
        status: updatedSubscription[0].status,
        cancel_at_period_end: updatedSubscription[0].cancel_at_period_end,
        canceled_at: updatedSubscription[0].canceled_at,
        current_period_end: updatedSubscription[0].current_period_end,
        plan: {
          name: plan.name,
          tier: plan.tier
        }
      },
      message: responseMessage
    });

  } catch (error) {
    console.error('Error canceling subscription:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const POST = withAuth(cancelSubscription);
