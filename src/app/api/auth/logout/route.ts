import { NextRequest } from 'next/server';
import { authenticateRequest } from '../../../../middleware/auth';
import { revokeSession } from '../../../../lib/auth/session';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     description: Logout user, invalidate session, and clear cookies
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 */
export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    const sessionData = await authenticateRequest(request);
    
    // Get session token from cookie or JWT payload
    const sessionCookie = request.cookies.get('session_token')?.value;
    
    // Revoke the session
    if (sessionCookie) {
      await revokeSession(sessionCookie);
    }

    // Create response with cleared cookies
    const response = createApiResponse({
      message: 'Logged out successfully'
    });

    // Clear HTTP-only cookies
    response.cookies.set('session_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/'
    });

    response.cookies.set('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/'
    });

    // Audit log
    await logAuditEvent({
      org_id: sessionData.org_id,
      user_id: sessionData.user_id,
      event_type: 'auth.logout',
      event_category: 'auth',
      actor_type: 'user',
      actor_id: sessionData.user_id,
      action: 'logout',
      description: `User ${sessionData.email} logged out`,
      metadata: {
        user_agent: request.headers.get('user-agent'),
        ip_address: request.headers.get('x-forwarded-for') || request.ip
      },
      request
    });

    return response;
  } catch (error: any) {
    return createErrorResponse(error.message, 401, ApiErrorCode.INVALID_SESSION);
  }
}
