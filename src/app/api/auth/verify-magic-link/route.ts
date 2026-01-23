import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { verifyTokenAndCreateSession } from '../../../../lib/auth/jwt-magic-link';
import { extractDeviceInfo } from '../../../../middleware/auth';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/verify-magic-link:
 *   post:
 *     summary: Verify magic link token
 *     description: Verify magic link token for both registration and login, creates user account if registration token, and creates session
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 example: abc123def456
 *                 description: Magic link token from email
 *     responses:
 *       200:
 *         description: Authentication successful, returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid or expired token
 *       429:
 *         description: Rate limit exceeded
 */
const schema = z.object({
  token: z.string().min(1, 'Token is required').trim(),
  device_data: z.object({
    device_id: z.string().optional(),
    user_agent: z.string().optional(),
  }).optional(),
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many requests', 429);
    }

    const body = await request.json();
    const { token, device_data } = schema.parse(body);
    
    const deviceInfo = extractDeviceInfo(request, device_data);
    const sessionResult = await verifyTokenAndCreateSession(token, deviceInfo);
    
    const response = createApiResponse({
      jwt_token: sessionResult.jwt_token,
      expires_at: sessionResult.expires_at.toISOString(),
      user: sessionResult.user
    });

    // Set HTTP-only cookies for session and refresh tokens
    response.cookies.set('session_token', sessionResult.session_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/'
    });

    response.cookies.set('refresh_token', sessionResult.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/'
    });

    // Set user plan tier cookie for middleware
    response.cookies.set('user_plan_tier', sessionResult.user.organization.plan_tier, {
      httpOnly: false, // Allow client-side access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/'
    });

    // Audit log successful login
    await logAuditEvent({
      org_id: sessionResult.user.org_id,
      user_id: sessionResult.user.id,
      event_type: 'auth.login_success',
      event_category: 'auth',
      actor_type: 'user',
      actor_id: sessionResult.user.id,
      action: 'login',
      description: `User ${sessionResult.user.email} logged in successfully`,
      metadata: { 
        device_type: deviceInfo.device_type,
        browser: deviceInfo.browser,
        os: deviceInfo.os 
      },
      request
    });

    return response;
  } catch (error: any) {
    // Audit log failed login attempt
    await logAuditEvent({
      event_type: 'auth.login_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `Login attempt failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400);
  }
}