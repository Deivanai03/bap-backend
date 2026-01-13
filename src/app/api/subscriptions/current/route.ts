import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { subscriptions, plans, usage_tracking, payment_methods } from '../../../../lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { getSubscription } from '../../../../lib/stripe';

/**
 * @swagger
 * /api/subscriptions/current:
 *   get:
 *     summary: Get current subscription
 *     description: Retrieve the organization's current subscription details
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current subscription details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No active subscription found
 *       429:
 *         description: Rate limit exceeded
 */
async function getCurrentSubscription(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Get current subscription with plan details
    const subscription = await db
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

    if (!subscription.length) {
      return createErrorResponse('No active subscription found', 404);
    }

    const { subscription: sub, plan } = subscription[0];

    // Get real Stripe subscription data
    let stripeSubscription = null;
    if (sub.stripe_subscription_id) {
      stripeSubscription = await getSubscription(sub.stripe_subscription_id);
      if (!stripeSubscription) {
        console.error('Failed to fetch Stripe subscription');
      }
    }

    // Use Stripe data if available, fallback to database
    const subscriptionData = {
      id: sub.id,
      plan_id: sub.plan_id,
      status: stripeSubscription?.status || sub.status,
      current_period_start: stripeSubscription ? 
        new Date(stripeSubscription.current_period_start * 1000) : 
        sub.current_period_start,
      current_period_end: stripeSubscription ? 
        new Date(stripeSubscription.current_period_end * 1000) : 
        sub.current_period_end,
      cancel_at_period_end: stripeSubscription?.cancel_at_period_end || false,
      created_at: sub.created_at,
      updated_at: sub.updated_at
    };

    // Get current period for usage calculation
    const periodStart = new Date(sub.current_period_start).toISOString().split('T')[0];
    const periodEnd = new Date(sub.current_period_end).toISOString().split('T')[0];

    // Get usage data for current period
    const usage = await db
      .select()
      .from(usage_tracking)
      .where(
        and(
          eq(usage_tracking.org_id, request.user.org_id),
          gte(usage_tracking.period_start, periodStart),
          lte(usage_tracking.period_end, periodEnd)
        )
      );

    // Calculate usage metrics
    const usageMetrics = {
      deep_dives: { used: 0, remaining: 0 },
      crafts: { used: 0, remaining: 0 },
      storage_gb: { used: 0, remaining: 0 },
      users: { used: 1, remaining: 0 } // Will be calculated from actual user count
    };

    usage.forEach(u => {
      if (u.metric_name === 'deep_dives') {
        usageMetrics.deep_dives.used += Number(u.metric_value);
      } else if (u.metric_name === 'crafts') {
        usageMetrics.crafts.used += Number(u.metric_value);
      } else if (u.metric_name === 'storage_gb') {
        usageMetrics.storage_gb.used += Number(u.metric_value);
      }
    });

    // Calculate remaining from plan limits
    const limits = plan.limits as any;
    usageMetrics.deep_dives.remaining = Math.max(0, (limits.max_deep_dives_per_month || 0) - usageMetrics.deep_dives.used);
    usageMetrics.crafts.remaining = Math.max(0, (limits.max_crafts_per_month || 0) - usageMetrics.crafts.used);
    usageMetrics.storage_gb.remaining = Math.max(0, (limits.max_storage_gb || 0) - usageMetrics.storage_gb.used);
    usageMetrics.users.remaining = Math.max(0, (limits.max_users || 1) - usageMetrics.users.used);

    let responseData: any = {
      id: sub.id,
      plan: {
        name: plan.name,
        tier: plan.tier,
        billing_period: plan.billing_period,
        features: plan.features,
        limits: plan.limits
      },
      usage: usageMetrics,
      status: sub.status
    };

    // Tier-based visibility
    if (plan.tier === 'FREE' || plan.tier === 'PRO') {
      // Individual/Pro plans: Full subscription info including payment details
      const paymentMethods = await db
        .select()
        .from(payment_methods)
        .where(
          and(
            eq(payment_methods.org_id, request.user.org_id),
            eq(payment_methods.deleted_at, null)
          )
        );

      responseData = {
        ...responseData,
        current_period_start: subscriptionData.current_period_start,
        current_period_end: subscriptionData.current_period_end,
        next_billing_date: subscriptionData.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        amount_incl_tax: Number(sub.amount_incl_tax),
        currency: sub.currency,
        payment_methods: paymentMethods.map(pm => ({
          id: pm.id,
          type: pm.type,
          card_brand: pm.card_brand,
          card_last4: pm.card_last4,
          is_default: pm.is_default
        }))
      };
    } else {
      // Business/Enterprise plans: Only limits shown per MD requirements
      responseData = {
        plan: {
          name: plan.name,
          tier: plan.tier,
          billing_period: plan.billing_period,
          features: plan.features,
          limits: plan.limits
        },
        usage: usageMetrics,
        message: 'Billing managed by organization owner'
      };
    }

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'subscription.viewed',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'subscription',
      resource_id: sub.id,
      action: 'view',
      description: `User viewed current subscription (${plan.tier})`,
      metadata: { 
        plan_tier: plan.tier,
        subscription_status: sub.status
      },
      request
    });

    return createApiResponse(responseData);
  } catch (error) {
    console.error('Error fetching current subscription:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(getCurrentSubscription);
