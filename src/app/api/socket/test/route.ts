import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';

/**
 * @swagger
 * /api/socket/test:
 *   post:
 *     summary: Test WebSocket broadcast
 *     description: Send a test message to all connected clients in the organization
 *     tags: [WebSocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               room:
 *                 type: string
 *                 description: Optional room to broadcast to
 *     responses:
 *       200:
 *         description: Message broadcasted successfully
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
    const body = await request.json();
    const { message, room } = body;

    if (!message) {
      return createErrorResponse('Message is required', 400, ApiErrorCode.INVALID_INPUT);
    }

    // Broadcast via WebSocket if available
    if (global.io) {
      const targetRoom = room || `org:${user.org_id}`;
      global.io.to(targetRoom).emit('test-message', {
        message,
        from: user.email,
        timestamp: new Date().toISOString()
      });
    }

    return createApiResponse({ 
      message: 'Broadcasted successfully',
      room: room || `org:${user.org_id}`
    });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    return createErrorResponse('Failed to broadcast message', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}
