import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { calls, users } from '../../../../lib/db/schema';
import { eq, and, or, inArray, desc } from 'drizzle-orm';

/**
 * @swagger
 * /api/calls/active:
 *   get:
 *     summary: Get active calls
 *     description: Retrieve all active calls for the authenticated user
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active calls retrieved successfully
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
 *                         calls:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               callType:
 *                                 type: string
 *                               status:
 *                                 type: string
 *                               startedAt:
 *                                 type: string
 *                                 format: date-time
 *                               caller:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   fullName:
 *                                     type: string
 *                                   email:
 *                                     type: string
 *                                   avatarUrl:
 *                                     type: string
 *                               callee:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   fullName:
 *                                     type: string
 *                                   email:
 *                                     type: string
 *                                   avatarUrl:
 *                                     type: string
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
    // Get active calls with caller info
    const activeCallsData = await db
      .select({
        id: calls.id,
        callType: calls.call_type,
        status: calls.status,
        startedAt: calls.started_at,
        callerId: calls.caller_id,
        calleeId: calls.callee_id,
        caller: {
          id: users.id,
          fullName: users.full_name,
          email: users.email,
          avatarUrl: users.avatar_url
        }
      })
      .from(calls)
      .innerJoin(users, eq(calls.caller_id, users.id))
      .where(
        and(
          eq(calls.org_id, user.org_id),
          or(
            eq(calls.caller_id, user.id),
            eq(calls.callee_id, user.id)
          ),
          inArray(calls.status, ['initiated', 'ringing', 'active'])
        )
      )
      .orderBy(desc(calls.started_at));

    // Get callee info for each call
    const activeCalls = await Promise.all(
      activeCallsData.map(async (call) => {
        const [callee] = await db
          .select({
            id: users.id,
            fullName: users.full_name,
            email: users.email,
            avatarUrl: users.avatar_url
          })
          .from(users)
          .where(eq(users.id, call.calleeId))
          .limit(1);

        return {
          id: call.id,
          callType: call.callType,
          status: call.status,
          startedAt: call.startedAt,
          caller: call.caller,
          callee
        };
      })
    );

    return createApiResponse({ calls: activeCalls });
  } catch (error) {
    console.error('Error fetching active calls:', error);
    return createErrorResponse('Failed to fetch active calls', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
