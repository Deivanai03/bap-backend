import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyToken } from '../../../../lib/auth/jwt';

/**
 * @swagger
 * /api/auth/socket-token:
 *   get:
 *     summary: Get socket authentication token
 *     description: Returns a JWT token for WebSocket authentication
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Socket token retrieved successfully
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
 *                         token:
 *                           type: string
 *                           description: JWT token for socket authentication
 *                         expiresAt:
 *                           type: string
 *                           format: date-time
 *                           description: Token expiration time
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       429:
 *         description: Rate limit exceeded
 */

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createErrorResponse('No token found', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token is valid
    const payload = await verifyToken(token);
    if (!payload) {
      return createErrorResponse('Invalid token', 401);
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return createApiResponse({
      token,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Error getting socket token:', error);
    return createErrorResponse('Failed to get token', 500);
  }
}
