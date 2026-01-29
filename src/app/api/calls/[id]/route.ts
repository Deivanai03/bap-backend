import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { calls, users } from '../../../../lib/db/schema';
import { eq, and, or } from 'drizzle-orm';

/**
 * @swagger
 * /api/calls/{id}:
 *   get:
 *     summary: Get specific call
 *     description: Retrieve details of a specific call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call retrieved successfully
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
 *                         call:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             callType:
 *                               type: string
 *                             status:
 *                               type: string
 *                             duration:
 *                               type: integer
 *                             startedAt:
 *                               type: string
 *                               format: date-time
 *                             endedAt:
 *                               type: string
 *                               format: date-time
 *                             caller:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: string
 *                                 fullName:
 *                                   type: string
 *                                 email:
 *                                   type: string
 *                                 avatarUrl:
 *                                   type: string
 *                             callee:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: string
 *                                 fullName:
 *                                   type: string
 *                                 email:
 *                                   type: string
 *                                 avatarUrl:
 *                                   type: string
 *       404:
 *         description: Call not found
 */

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;
  const { id } = params;

  try {
    // Get call with caller and callee info
    const callData = await db
      .select({
        id: calls.id,
        callType: calls.call_type,
        status: calls.status,
        duration: calls.duration,
        metadata: calls.metadata,
        startedAt: calls.started_at,
        endedAt: calls.ended_at,
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
          eq(calls.id, id),
          eq(calls.org_id, user.org_id),
          or(
            eq(calls.caller_id, user.id),
            eq(calls.callee_id, user.id)
          )
        )
      )
      .limit(1);

    if (callData.length === 0) {
      return createErrorResponse('Call not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Get callee info separately
    const [calleeData] = await db
      .select({
        id: users.id,
        fullName: users.full_name,
        email: users.email,
        avatarUrl: users.avatar_url
      })
      .from(users)
      .innerJoin(calls, eq(users.id, calls.callee_id))
      .where(eq(calls.id, id))
      .limit(1);

    const call = {
      ...callData[0],
      callee: calleeData
    };

    return createApiResponse({ call });
  } catch (error) {
    console.error('Error fetching call:', error);
    return createErrorResponse('Failed to fetch call', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
