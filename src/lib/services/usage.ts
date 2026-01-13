import { db } from '../db';
import { usage_tracking, organizations, plans } from '../db/schema';
import { eq, and, gte, lte, sum } from 'drizzle-orm';

export interface UsageCheck {
  allowed: boolean;
  current_usage: number;
  limit: number;
  remaining: number;
  message?: string;
}

export async function checkUsageLimit(
  orgId: string, 
  metric: string, 
  requestedAmount: number = 1
): Promise<UsageCheck> {
  // Get current period (this month)
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  // Get organization plan limits from existing tables
  const [orgPlan] = await db
    .select({
      plan_limits: plans.limits,
      plan_tier: organizations.plan_tier
    })
    .from(organizations)
    .innerJoin(plans, eq(organizations.plan_tier, plans.tier))
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!orgPlan) {
    return { allowed: false, current_usage: 0, limit: 0, remaining: 0, message: 'Plan not found' };
  }

  const limits = orgPlan.plan_limits as any;
  const limit = getMetricLimit(metric, limits);

  // Get current usage from existing usage_tracking table
  const [usage] = await db
    .select({
      total: sum(usage_tracking.metric_value)
    })
    .from(usage_tracking)
    .where(
      and(
        eq(usage_tracking.org_id, orgId),
        eq(usage_tracking.metric_name, metric),
        gte(usage_tracking.period_start, periodStart),
        lte(usage_tracking.period_end, periodEnd)
      )
    );

  const currentUsage = Number(usage?.total) || 0;
  const remaining = Math.max(0, limit - currentUsage);
  const allowed = currentUsage + requestedAmount <= limit;

  return {
    allowed,
    current_usage: currentUsage,
    limit,
    remaining,
    message: allowed ? undefined : `${metric} limit exceeded`
  };
}

export async function recordUsage(
  orgId: string,
  metric: string,
  amount: number,
  userId?: string
): Promise<void> {
  const now = new Date();
  const periodStart = now.toISOString().split('T')[0];

  // Insert into existing usage_tracking table
  await db.insert(usage_tracking).values({
    org_id: orgId,
    user_id: userId,
    metric_name: metric,
    metric_value: amount.toString(),
    unit: 'count',
    period_start: periodStart,
    period_end: periodStart,
    recorded_at: now
  });
}

function getMetricLimit(metric: string, limits: any): number {
  const limitMap: Record<string, string> = {
    'deep_dives': 'max_deep_dives_per_month',
    'crafts': 'max_crafts_per_month',
    'storage_gb': 'max_storage_gb',
    'api_requests': 'requests_per_day'
  };

  const limitKey = limitMap[metric];
  return limitKey ? (limits[limitKey] || 0) : 0;
}
