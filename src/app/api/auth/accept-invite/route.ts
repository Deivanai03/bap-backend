import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { createSession } from '../../../../lib/auth/session';
import { extractDeviceInfo } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required').trim(),
  full_name: z.string().min(2).max(255).trim().optional(),
  device_data: z.object({
    device_id: z.string().optional(),
    user_agent: z.string().optional(),
  }).optional(),
});

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/auth/accept-invite:
 *   get:
 *     summary: Validate invitation token
 *     description: Validates an invitation token and returns the invitation details
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The invitation token
 *     responses:
 *       200:
 *         description: Valid invitation
 *       400:
 *         description: Invalid or expired token
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
  }

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return createErrorResponse('Invitation token is required', 400, ApiErrorCode.MISSING_REQUIRED_FIELD);
    }

    // Find user by invitation token
    const [invitedUser] = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        status: users.status,
        invitation_expires_at: users.invitation_expires_at,
      })
      .from(users)
      .where(eq(users.invitation_token, token.trim()))
      .limit(1);

    if (!invitedUser) {
      return createErrorResponse('Invalid invitation token', 400, ApiErrorCode.INVALID_TOKEN);
    }

    if (invitedUser.status !== 'invited') {
      return createErrorResponse('This invitation has already been used', 400, ApiErrorCode.INVALID_TOKEN);
    }

    if (invitedUser.invitation_expires_at && invitedUser.invitation_expires_at < new Date()) {
      return createErrorResponse('This invitation has expired', 400, ApiErrorCode.EXPIRED_TOKEN);
    }

    return createApiResponse({
      email: invitedUser.email,
      full_name: invitedUser.full_name,
    });
  } catch (error: any) {
    console.error('Error validating invitation:', error);
    return createErrorResponse(error.message || 'Failed to validate invitation', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}

/**
 * @swagger
 * /api/auth/accept-invite:
 *   post:
 *     summary: Accept invitation and create session
 *     description: Accepts the invitation, activates the user account, and creates a session
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
 *               full_name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitation accepted, session created
 *       400:
 *         description: Invalid or expired token
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
  }

  try {
    const body = await request.json();
    const { token, full_name, device_data } = acceptInviteSchema.parse(body);

    // Find user by invitation token
    const [invitedUser] = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        role: users.role,
        org_id: users.org_id,
        status: users.status,
        invitation_expires_at: users.invitation_expires_at,
      })
      .from(users)
      .where(eq(users.invitation_token, token.trim()))
      .limit(1);

    if (!invitedUser) {
      return createErrorResponse('Invalid invitation token', 400, ApiErrorCode.INVALID_TOKEN);
    }

    if (invitedUser.status !== 'invited') {
      return createErrorResponse('This invitation has already been used', 400, ApiErrorCode.INVALID_TOKEN);
    }

    if (invitedUser.invitation_expires_at && invitedUser.invitation_expires_at < new Date()) {
      return createErrorResponse('This invitation has expired', 400, ApiErrorCode.EXPIRED_TOKEN);
    }

    // Update user to active status and clear invitation fields
    await db
      .update(users)
      .set({
        status: 'active',
        full_name: full_name || invitedUser.full_name,
        invitation_token: null,
        invitation_expires_at: null,
        email_verified: true,
        updated_at: new Date(),
      })
      .where(eq(users.id, invitedUser.id));

    // Extract device info
    const deviceInfo = extractDeviceInfo(request, device_data);

    // Create session for the new user
    const sessionResult = await createSession({
      user_id: invitedUser.id,
      org_id: invitedUser.org_id,
      email: invitedUser.email,
      role: invitedUser.role,
      device_id: deviceInfo.device_id,
      device_type: deviceInfo.device_type,
      device_name: deviceInfo.device_name,
      os: deviceInfo.os,
      browser: deviceInfo.browser,
      ip_address: deviceInfo.ip_address,
      user_agent: deviceInfo.user_agent,
    });

    const response = createApiResponse({
      jwt_token: sessionResult.jwt_token,
      expires_at: sessionResult.expires_at.toISOString(),
      user: sessionResult.user,
    });

    // Set HTTP-only cookies for session and refresh tokens
    response.cookies.set('session_token', sessionResult.session_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    response.cookies.set('refresh_token', sessionResult.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    // Set user plan tier cookie for middleware
    response.cookies.set('user_plan_tier', sessionResult.user.organization.plan_tier, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    // Audit log
    await logAuditEvent({
      org_id: invitedUser.org_id,
      user_id: invitedUser.id,
      event_type: 'user.invitation_accepted',
      event_category: 'users',
      actor_type: 'user',
      actor_id: invitedUser.id,
      resource_type: 'user',
      resource_id: invitedUser.id,
      action: 'accepted',
      description: `User ${invitedUser.email} accepted invitation and joined the organization`,
      metadata: {
        device_type: deviceInfo.device_type,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      },
      request,
    });

    return response;
  } catch (error: any) {
    console.error('Error accepting invitation:', error);

    if (error.name === 'ZodError') {
      return createErrorResponse(error.errors[0].message, 400, ApiErrorCode.INVALID_INPUT);
    }

    return createErrorResponse(error.message || 'Failed to accept invitation', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}
