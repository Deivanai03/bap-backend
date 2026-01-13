import { NextRequest, NextResponse } from 'next/server';
import { refreshSession } from '../../../../lib/auth/session';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh JWT token
 *     description: Refresh an expired JWT token using refresh token from cookies
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Invalid or expired refresh token
 *       429:
 *         description: Rate limit exceeded
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Get refresh token from cookie
    const refreshToken = request.cookies.get('refresh_token')?.value;
    
    if (!refreshToken) {
      return createErrorResponse('Refresh token not found', 401);
    }

    // Refresh the session
    const sessionResult = await refreshSession(refreshToken);
    
    if (!sessionResult) {
      return createErrorResponse('Invalid or expired refresh token', 401);
    }

    // Set new HTTP-only cookies
    const response = createApiResponse({
      jwt_token: sessionResult.jwt_token,
      expires_at: sessionResult.expires_at.toISOString(),
      user: sessionResult.user,
    });

    // Set new session token cookie
    response.cookies.set('session_token', sessionResult.session_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/'
    });

    // Set new refresh token cookie
    response.cookies.set('refresh_token', sessionResult.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/'
    });

    // Audit log
    await logAuditEvent({
      org_id: sessionResult.user.org_id,
      user_id: sessionResult.user.id,
      event_type: 'session.refreshed',
      event_category: 'auth',
      actor_type: 'user',
      actor_id: sessionResult.user.id,
      action: 'refresh_token',
      description: 'User refreshed their session using refresh token',
      metadata: {
        user_agent: request.headers.get('user-agent'),
        ip_address: request.headers.get('x-forwarded-for') || request.ip
      },
      request
    });

    return response;

  } catch (error: any) {
    console.error('Refresh token error:', error);
    
    if (error.code === 'INVALID_REFRESH_TOKEN' || error.code === 'REFRESH_TOKEN_EXPIRED') {
      return createErrorResponse(error.message, 401);
    }
    
    return createErrorResponse('Internal server error', 500);
  }
}
