import { AuthenticatedRequest } from './auth';
import { db } from '../lib/db';
import { subscriptions, plans, usage_tracking } from '../lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

export interface PlanFeatures {
  voice_mode: boolean;
  team_messaging: boolean;
  deep_dives: boolean;
  surge_engine: boolean;
  asset_driving: boolean;
  custom_ontology: boolean;
  sso: boolean;
  api_access: boolean;
}

export interface PlanLimits {
  max_users: number;
  max_deep_dives_per_month: number;
  max_crafts_per_month: number;
  max_storage_gb: number;
  requests_per_day: number;
  context_window_tokens: number;
  max_asset_connections: number;
}

export async function getCurrentPlan(orgId: string) {
  const result = await db
    .select({
      plan: plans,
      subscription: subscriptions
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.plan_id, plans.id))
    .where(
      and(
        eq(subscriptions.org_id, orgId),
        eq(subscriptions.status, 'active')
      )
    )
    .limit(1);

  if (!result.length) {
    throw new Error('No active subscription found');
  }

  return {
    plan: result[0].plan,
    subscription: result[0].subscription,
    features: result[0].plan.features as PlanFeatures,
    limits: result[0].plan.limits as PlanLimits
  };
}

export function requireFeature(feature: keyof PlanFeatures) {
  return async (request: AuthenticatedRequest) => {
    const { features } = await getCurrentPlan(request.user.org_id);
    
    if (!features[feature]) {
      throw new Error(`Feature '${feature}' not available in current plan`);
    }
  };
}

export function requirePlanTier(allowedTiers: string[]) {
  return async (request: AuthenticatedRequest) => {
    const { plan } = await getCurrentPlan(request.user.org_id);
    
    if (!allowedTiers.includes(plan.tier)) {
      throw new Error(`Plan tier '${plan.tier}' not allowed. Required: ${allowedTiers.join(', ')}`);
    }
  };
}

export async function checkUsageLimit(orgId: string, metric: keyof PlanLimits): Promise<{
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}> {
  const { limits } = await getCurrentPlan(orgId);
  
  // Get current usage from usage_tracking table
  const currentPeriodStart = new Date();
  currentPeriodStart.setDate(1); // Start of current month
  const currentPeriodEnd = new Date(currentPeriodStart);
  currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
  
  const usageRecords = await db
    .select()
    .from(usage_tracking)
    .where(
      and(
        eq(usage_tracking.org_id, orgId),
        eq(usage_tracking.metric_name, metric),
        gte(usage_tracking.period_start, currentPeriodStart.toISOString().split('T')[0]),
        lte(usage_tracking.period_end, currentPeriodEnd.toISOString().split('T')[0])
      )
    );
  
  const used = usageRecords.reduce((total, record) => total + Number(record.metric_value), 0);
  const limit = limits[metric];
  const remaining = Math.max(0, limit - used);
  const exceeded = used >= limit;
  
  return { used, limit, remaining, exceeded };
}

export function requireUsageLimit(metric: keyof PlanLimits) {
  return async (request: AuthenticatedRequest) => {
    const usage = await checkUsageLimit(request.user.org_id, metric);
    
    if (usage.exceeded) {
      throw new Error(`Usage limit exceeded for ${metric}. Used: ${usage.used}/${usage.limit}`);
    }
  };
}

export async function trackUsage(orgId: string, metric: keyof PlanLimits, value: number = 1): Promise<void> {
  const currentDate = new Date();
  const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
  await db.insert(usage_tracking).values({
    org_id: orgId,
    metric_name: metric,
    metric_value: value.toString(),
    period_start: periodStart.toISOString().split('T')[0],
    period_end: periodEnd.toISOString().split('T')[0],
    recorded_at: currentDate
  });
}

export function withUsageTracking(metric: keyof PlanLimits, value: number = 1) {
  return async (request: AuthenticatedRequest) => {
    // Check limit before allowing action
    await requireUsageLimit(metric)(request);
    
    // Track usage after successful action
    await trackUsage(request.user.org_id, metric, value);
  };
}
