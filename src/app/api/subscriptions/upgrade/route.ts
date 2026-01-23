import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { subscriptions, plans, organizations } from '../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../middleware/auth';
import { requirePermission } from '../../../../middleware/rbac';
import { handleStripeError, handleDatabaseError } from '../../../../lib/errors/handlers';
import { ApiErrorCode, createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { updateSubscription } from '../../../../lib/stripe';
import { UpgradeSubscriptionSchema } from '../../../../types/billing';
import { handleOptions } from '../../../../lib/api/cors';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/subscriptions/upgrade:
 *   post:
 *     summary: Upgrade subscription
 *     description: Upgrade the organization's subscription to a higher plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - plan_id
 *             properties:
 *               plan_id:
 *                 type: string
 *                 format: uuid
 *                 example: 550e8400-e29b-41d4-a716-446655440000
 *               proration:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to prorate the upgrade
 *     responses:
 *       200:
 *         description: Subscription upgraded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid plan or request data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Current subscription not found
 *       429:
 *         description: Rate limit exceeded
 */
async function upgradeSubscription(request: AuthenticatedRequest) {
  try {
    // Role-based access control - only OWNER can upgrade subscriptions per MD requirements
    requirePermission('upgrade_subscription')(request);

    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = UpgradeSubscriptionSchema.safeParse(body);
    
    if (!validation.success) {
      return createErrorResponse(
        `Invalid request: ${validation.error.issues.map(e => e.message).join(', ')}`,
        400
      );
    }

    const { plan_id, proration = true } = validation.data;

    // Get current subscription
    const currentSubscription = await db
      .select({
        subscription: subscriptions,
        currentPlan: plans
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

    const { subscription: currentSub, currentPlan } = currentSubscription[0];

    // Get target plan
    const targetPlan = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, plan_id), eq(plans.is_active, true)))
      .limit(1);

    if (!targetPlan.length) {
      return createErrorResponse('Target plan not found or inactive', 404);
    }

    const newPlan = targetPlan[0];

    // Validate upgrade (can't downgrade to lower tier, but allow same tier changes)
    const tierHierarchy = { 'FREE': 1, 'PRO': 2, 'BUSINESS': 3, 'ENTERPRISE': 4 };
    const currentTierLevel = tierHierarchy[currentPlan.tier as keyof typeof tierHierarchy];
    const newTierLevel = tierHierarchy[newPlan.tier as keyof typeof tierHierarchy];

    if (newTierLevel < currentTierLevel) {
      return createErrorResponse('Cannot downgrade to a lower tier. Please contact support for downgrades.', 400);
    }

    if (currentSub.plan_id === plan_id) {
      return createErrorResponse('Already subscribed to this plan', 400);
    }

    // Get organization tax_id
    const [org] = await db
      .select({ tax_id: organizations.tax_id, billing_country: organizations.billing_country })
      .from(organizations)
      .where(eq(organizations.id, request.user.org_id))
      .limit(1);

    // Update subscription with Stripe Tax
    const stripeSubscription = await updateSubscription(
      currentSub.stripe_subscription_id!, 
      newPlan.stripe_prices[currentSub.currency] as string,
      org?.tax_id || undefined
    );

    if (!stripeSubscription) {
      return createErrorResponse('Failed to update subscription with Stripe', 500);
    }

    // Get tax info from Stripe response
    const latestInvoice = stripeSubscription.latest_invoice as any;
    const taxAmount = latestInvoice?.tax || 0;
    const subtotal = latestInvoice?.subtotal || 0;
    const total = latestInvoice?.total || 0;
    const taxRate = subtotal > 0 ? taxAmount / subtotal : 0;

    // Update subscription in database with Stripe tax data
    const stripeData = stripeSubscription as any;
    
    // Safely convert Stripe timestamps (they might be null/undefined)
    const periodStart = stripeData.current_period_start ? new Date(stripeData.current_period_start * 1000) : new Date();
    const periodEnd = stripeData.current_period_end ? new Date(stripeData.current_period_end * 1000) : new Date();
    
    const updatedSubscription = await db
      .update(subscriptions)
      .set({
        plan_id: plan_id,
        amount_excl_tax: (subtotal / 100).toFixed(2), // Stripe amounts are in cents
        tax_rate: taxRate.toFixed(4),
        amount_incl_tax: (total / 100).toFixed(2),
        current_period_start: periodStart,
        current_period_end: periodEnd,
        updated_at: new Date(),
      })
      .where(eq(subscriptions.id, currentSub.id))
      .returning();

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'subscription.upgraded',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'subscription',
      resource_id: currentSub.id,
      action: 'upgrade',
      description: `Subscription upgraded from ${currentPlan.name} to ${newPlan.name}`,
      changes: {
        from: {
          plan_id: currentSub.plan_id,
          plan_name: currentPlan.name,
          tier: currentPlan.tier,
          amount: currentSub.amount_incl_tax
        },
        to: {
          plan_id: plan_id,
          plan_name: newPlan.name,
          tier: newPlan.tier,
          amount: total / 100 // Convert from cents
        }
      },
      metadata: { 
        proration,
        upgrade_type: newTierLevel > currentTierLevel ? 'tier_upgrade' : 'same_tier'
      },
      request
    });

    return createApiResponse({
      subscription: {
        id: updatedSubscription[0].id,
        plan: {
          id: newPlan.id,
          name: newPlan.name,
          tier: newPlan.tier,
          billing_period: newPlan.billing_period,
          features: newPlan.features,
          limits: newPlan.limits
        },
        status: updatedSubscription[0].status,
        amount_incl_tax: total / 100, // Convert from cents
        currency: updatedSubscription[0].currency,
        current_period_start: stripeData.current_period_start ? new Date(stripeData.current_period_start * 1000).toISOString() : updatedSubscription[0].current_period_start,
        current_period_end: stripeData.current_period_end ? new Date(stripeData.current_period_end * 1000).toISOString() : updatedSubscription[0].current_period_end,
        next_billing_date: stripeData.current_period_end ? new Date(stripeData.current_period_end * 1000).toISOString() : updatedSubscription[0].current_period_end,
        proration_applied: proration
      },
      message: `Successfully upgraded to ${newPlan.name} ${newPlan.billing_period}`
    });

  } catch (error: any) {
    console.error('Error upgrading subscription:', error);
    
    // Handle specific error types
    if (error.message?.includes('Insufficient permissions')) {
      return createErrorResponse(error.message, 403, ApiErrorCode.INSUFFICIENT_PERMISSIONS);
    }
    
    if (error.type?.startsWith('Stripe')) {
      return handleStripeError(error);
    }
    
    if (error.code || error.message?.includes('Failed query')) {
      return handleDatabaseError(error);
    }
    
    return createErrorResponse('Internal server error', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}

export const POST = withAuth(upgradeSubscription);
