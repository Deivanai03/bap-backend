import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../../lib/api/response';
import { handleOptions } from '../../../../../lib/api/cors';
import { apiRateLimit } from '../../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../../middleware/auth';
import { db } from '../../../../../lib/db';
import { voice_sessions } from '../../../../../lib/db/schema';
import { v4 as uuidv4 } from 'uuid';

/**
 * @swagger
 * /api/input-agent/voice/start:
 *   post:
 *     summary: Start voice session
 *     description: Start a new voice recording session
 *     tags: [Input Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Voice session started successfully
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
 *                         status:
 *                           type: string
 *                           enum: [active]
 */

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
    const sessionId = uuidv4();
    
    // Create voice session
    await db.insert(voice_sessions).values({
      id: sessionId,
      org_id: user.org_id,
      user_id: user.id,
      session_status: 'active',
      started_at: new Date()
    });

    return createApiResponse({
      sessionId,
      status: 'active',
    });
  } catch (error) {
    console.error('Error starting voice session:', error);
    return createErrorResponse('Failed to start voice session', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
