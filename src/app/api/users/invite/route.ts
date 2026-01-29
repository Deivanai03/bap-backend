import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'crypto';
import { sendInvitationEmail } from '../../../../lib/email';

const inviteSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  full_name: z.string().min(2).max(255).trim().optional(),
  role: z.enum(['MEMBER', 'ADMIN']).default('MEMBER'),
});

export async function OPTIONS() {
  return handleOptions();
}

/**
 * @swagger
 * /api/users/invite:
 *   get:
 *     summary: Get pending invitations
 *     description: Retrieve all pending invitations for the organization (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending invitations retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;

  // Check if user is admin or owner
  if (!['ADMIN', 'OWNER'].includes(user.role)) {
    return createErrorResponse('Insufficient permissions', 403, ApiErrorCode.INSUFFICIENT_PERMISSIONS);
  }

  try {
    // Fetch pending invitations (users with status 'invited')
    const invitations = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        role: users.role,
        invitation_expires_at: users.invitation_expires_at,
        created_at: users.created_at,
      })
      .from(users)
      .where(
        and(
          eq(users.org_id, user.org_id),
          eq(users.status, 'invited')
        )
      )
      .orderBy(users.created_at);

    return createApiResponse({
      invitations,
    });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return createErrorResponse('Failed to fetch invitations', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

/**
 * @swagger
 * /api/users/invite:
 *   post:
 *     summary: Invite a new team member
 *     description: Send an invitation to a new user to join the organization (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               full_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [MEMBER, ADMIN]
 *                 default: MEMBER
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: User already exists
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;

  // Check if user is admin or owner
  if (!['ADMIN', 'OWNER'].includes(user.role)) {
    return createErrorResponse('Insufficient permissions', 403, ApiErrorCode.INSUFFICIENT_PERMISSIONS);
  }

  try {
    const body = await request.json();
    const data = inviteSchema.parse(body);

    // Check if user already exists in any organization
    const [existingUser] = await db
      .select({ id: users.id, status: users.status, org_id: users.org_id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (existingUser) {
      if (existingUser.org_id === user.org_id) {
        return createErrorResponse('User is already a member of this organization', 409);
      }
      return createErrorResponse('User already exists with this email', 409);
    }

    // Generate invitation token
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invited user
    const [newUser] = await db
      .insert(users)
      .values({
        org_id: user.org_id,
        email: data.email,
        full_name: data.full_name || null,
        role: data.role,
        status: 'invited',
        invited_by: user.user_id,
        invitation_token: invitationToken,
        invitation_expires_at: invitationExpiresAt,
      })
      .returning({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        role: users.role,
        invitation_expires_at: users.invitation_expires_at,
        created_at: users.created_at,
      });

    // Send invitation email
    const inviteLink = `${process.env.FRONTEND_URL}/accept-invite?token=${invitationToken}`;
    await sendInvitationEmail(data.email, inviteLink, user.full_name || user.email);

    // Audit log
    await logAuditEvent({
      event_type: 'user.invited',
      event_category: 'users',
      actor_type: 'user',
      actor_id: user.user_id,
      org_id: user.org_id,
      resource_type: 'user',
      resource_id: newUser.id,
      action: 'invited',
      description: `User ${data.email} was invited by ${user.email}`,
      metadata: {
        invited_email: data.email,
        invited_role: data.role,
        invited_by: user.email
      },
      request,
    });

    return createApiResponse({
      message: 'Invitation sent successfully',
      invitation: newUser,
    });
  } catch (error: any) {
    console.error('Error sending invitation:', error);

    if (error.name === 'ZodError') {
      return createErrorResponse(error.errors[0].message, 400, ApiErrorCode.INVALID_INPUT);
    }

    return createErrorResponse(error.message || 'Failed to send invitation', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}
