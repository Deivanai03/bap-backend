import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { plans } from '../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { logAuditEvent } from '../../../lib/audit/logger';
import { apiRateLimit } from '../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/plans:
 *   get:
 *     summary: Get all available plans
 *     description: Retrieve all active subscription plans with features and limits
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [FREE, PRO, BUSINESS, ENTERPRISE]
 *         description: Filter by plan tier
 *       - in: query
 *         name: billing_period
 *         schema:
 *           type: string
 *           enum: [monthly, yearly]
 *         description: Filter by billing period
 *     responses:
 *       200:
 *         description: List of available plans
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Plan'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
async function getPlans(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    const { searchParams } = new URL(request.url);
    const tier = searchParams.get('tier');
    const billing_period = searchParams.get('billing_period');

    // Build query conditions
    const conditions = [eq(plans.is_active, true)];
    
    if (tier) {
      const validTiers = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'];
      if (!validTiers.includes(tier.toUpperCase())) {
        return createErrorResponse('Invalid tier. Must be one of: FREE, PRO, BUSINESS, ENTERPRISE', 400);
      }
      conditions.push(eq(plans.tier, tier.toUpperCase() as any));
    }

    if (billing_period) {
      const validPeriods = ['monthly', 'yearly'];
      if (!validPeriods.includes(billing_period.toLowerCase())) {
        return createErrorResponse('Invalid billing_period. Must be one of: monthly, yearly', 400);
      }
      conditions.push(eq(plans.billing_period, billing_period.toLowerCase() as any));
    }

    const availablePlans = await db
      .select()
      .from(plans)
      .where(and(...conditions))
      .orderBy(plans.display_order);

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'plans.viewed',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'plans',
      action: 'view',
      description: `User viewed available plans${tier ? ` (tier: ${tier})` : ''}${billing_period ? ` (period: ${billing_period})` : ''}`,
      metadata: { 
        filters: { tier, billing_period },
        plans_count: availablePlans.length 
      },
      request
    });

    return createApiResponse({
      plans: availablePlans,
      count: availablePlans.length
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(getPlans);
