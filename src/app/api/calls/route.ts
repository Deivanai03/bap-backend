import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { db } from '../../../lib/db';
import { calls, users } from '../../../lib/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

/**
 * @swagger
 * /api/calls:
 *   post:
 *     summary: Initiate a call
 *     description: Start a new video or voice call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - calleeId
 *             properties:
 *               calleeId:
 *                 type: string
 *                 format: uuid
 *               callType:
 *                 type: string
 *                 enum: [video, voice]
 *                 default: video
 *     responses:
 *       201:
 *         description: Call initiated successfully
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
 *                             startedAt:
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
 *         description: Callee not found
 */

const initiateCallSchema = z.object({
  calleeId: z.string().uuid(),
  callType: z.enum(['video', 'voice']).default('video')
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
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
    const body = await request.json();
    const validatedData = initiateCallSchema.parse(body);
    const { calleeId, callType } = validatedData;

    // Verify callee exists in same organization
    const [callee] = await db
      .select({
        id: users.id,
        fullName: users.full_name,
        email: users.email,
        avatarUrl: users.avatar_url
      })
      .from(users)
      .where(
        and(
          eq(users.id, calleeId),
          eq(users.org_id, user.org_id)
        )
      )
      .limit(1);

    if (!callee) {
      return createErrorResponse('Callee not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Create call session
    const callId = uuidv4();
    const [newCall] = await db
      .insert(calls)
      .values({
        id: callId,
        org_id: user.org_id,
        caller_id: user.id,
        callee_id: calleeId,
        call_type: callType,
        status: 'initiated',
        started_at: new Date()
      })
      .returning();

    const callResponse = {
      id: newCall.id,
      callType: newCall.call_type,
      status: newCall.status,
      startedAt: newCall.started_at,
      caller: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        avatarUrl: user.avatar_url
      },
      callee
    };

    return createApiResponse({ call: callResponse }, true, []);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error initiating call:', error);
    return createErrorResponse('Failed to initiate call', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
