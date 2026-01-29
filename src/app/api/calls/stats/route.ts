import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { calls } from '../../../../lib/db/schema';
import { eq, and, or, gte, sql } from 'drizzle-orm';

/**
 * @swagger
 * /api/calls/stats:
 *   get:
 *     summary: Get call statistics
 *     description: Retrieve call statistics for the authenticated user
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *           default: week
 *         description: Time period for statistics
 *     responses:
 *       200:
 *         description: Call statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         stats:
 *                           type: object
 *                           properties:
 *                             totalCalls:
 *                               type: integer
 *                             totalDuration:
 *                               type: integer
 *                             avgDuration:
 *                               type: number
 *                             videoCallsCount:
 *                               type: integer
 *                             voiceCallsCount:
 *                               type: integer
 *                             completedCalls:
 *                               type: integer
 *                             missedCalls:
 *                               type: integer
 */

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'week';
    
    let dateFilter = new Date();
    switch (period) {
      case 'day':
        dateFilter.setDate(dateFilter.getDate() - 1);
        break;
      case 'week':
        dateFilter.setDate(dateFilter.getDate() - 7);
        break;
      case 'month':
        dateFilter.setMonth(dateFilter.getMonth() - 1);
        break;
    }

    // Get call statistics using SQL aggregation
    const [stats] = await db
      .select({
        totalCalls: sql<number>`COUNT(*)`,
        totalDuration: sql<number>`COALESCE(SUM(${calls.duration}), 0)`,
        avgDuration: sql<number>`COALESCE(AVG(${calls.duration}), 0)`,
        videoCallsCount: sql<number>`COUNT(CASE WHEN ${calls.call_type} = 'video' THEN 1 END)`,
        voiceCallsCount: sql<number>`COUNT(CASE WHEN ${calls.call_type} = 'voice' THEN 1 END)`,
        completedCalls: sql<number>`COUNT(CASE WHEN ${calls.status} = 'ended' THEN 1 END)`,
        missedCalls: sql<number>`COUNT(CASE WHEN ${calls.status} = 'missed' THEN 1 END)`
      })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, user.org_id),
          or(
            eq(calls.caller_id, user.id),
            eq(calls.callee_id, user.id)
          ),
          gte(calls.started_at, dateFilter)
        )
      );

    const result = stats || {
      totalCalls: 0,
      totalDuration: 0,
      avgDuration: 0,
      videoCallsCount: 0,
      voiceCallsCount: 0,
      completedCalls: 0,
      missedCalls: 0,
    };

    return createApiResponse({ stats: result });
  } catch (error) {
    console.error('Error fetching call stats:', error);
    return createErrorResponse('Failed to fetch call stats', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
