import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../../lib/api/response';
import { handleOptions } from '../../../../../lib/api/cors';
import { apiRateLimit } from '../../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../../middleware/auth';
import { db } from '../../../../../lib/db';
import { voice_sessions } from '../../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/input-agent/voice/end:
 *   post:
 *     summary: End voice session
 *     description: End an active voice recording session
 *     tags: [Input Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Voice session ended successfully
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
 *                         sessionId:
 *                           type: string
 *                         transcript:
 *                           type: string
 *                         duration:
 *                           type: integer
 *                         status:
 *                           type: string
 *                           enum: [ended]
 *       404:
 *         description: Voice session not found
 */

const endVoiceSchema = z.object({
  sessionId: z.string().uuid()
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
    const validatedData = endVoiceSchema.parse(body);
    const { sessionId } = validatedData;

    // Find and update voice session
    const [session] = await db
      .update(voice_sessions)
      .set({ 
        session_status: 'ended',
        ended_at: new Date()
      })
      .where(
        and(
          eq(voice_sessions.id, sessionId),
          eq(voice_sessions.user_id, user.id),
          eq(voice_sessions.org_id, user.org_id)
        )
      )
      .returning();

    if (!session) {
      return createErrorResponse('Voice session not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Calculate duration if both start and end times exist
    let duration = null;
    if (session.started_at && session.ended_at) {
      duration = Math.floor((session.ended_at.getTime() - session.started_at.getTime()) / 1000);
    }

    return createApiResponse({
      sessionId,
      transcript: session.transcript,
      duration,
      status: 'ended',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error ending voice session:', error);
    return createErrorResponse('Failed to end voice session', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
