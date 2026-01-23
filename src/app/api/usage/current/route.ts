import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { usage_tracking, subscriptions, plans } from '../../../../lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/usage/current:
 *   get:
 *     summary: Get current usage metrics
 *     description: Retrieve current period usage metrics for the organization
 *     tags: [Usage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current usage metrics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
async function getCurrentUsage(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Get current subscription and plan
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

    // Get current period dates
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

    // Calculate usage metrics per MD requirements
    const limits = plan.limits as any;
    const usageMetrics: any = {};

    // Initialize all metrics from plan limits
    Object.keys(limits).forEach(key => {
      if (key.startsWith('max_')) {
        const metricName = key.replace('max_', '').replace('_per_month', '');
        usageMetrics[metricName] = {
          used: 0,
          limit: limits[key],
          remaining: limits[key]
        };
      }
    });

    // Aggregate actual usage
    usage.forEach(u => {
      if (usageMetrics[u.metric_name]) {
        usageMetrics[u.metric_name].used += Number(u.metric_value);
      }
    });

    // Calculate remaining
    Object.keys(usageMetrics).forEach(metric => {
      const used = usageMetrics[metric].used;
      const limit = usageMetrics[metric].limit;
      usageMetrics[metric].remaining = Math.max(0, limit - used);
    });

    return createApiResponse({
      period: {
        start: sub.current_period_start,
        end: sub.current_period_end
      },
      metrics: usageMetrics,
      plan: {
        name: plan.name,
        tier: plan.tier,
        limits: plan.limits
      }
    });

  } catch (error) {
    console.error('Error fetching usage:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(getCurrentUsage);
