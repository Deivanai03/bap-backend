import { NextRequest } from 'next/server';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { users, organizations, audit_events } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     description: Retrieve the authenticated user's profile information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 *   put:
 *     summary: Update user profile
 *     description: Update the authenticated user's profile information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *             required:
 *               - full_name
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
export async function OPTIONS() {
  return handleOptions();
}

const updateProfileSchema = z.object({
  full_name: z.string()
    .min(1, 'full_name is required')
    .max(100, 'full_name must be between 1 and 100 characters')
    .regex(/^[a-zA-Z\s\-']+$/, 'full_name contains invalid characters')
    .transform(val => val.trim())
});

export async function PUT(request: NextRequest) {
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
    const validatedData = updateProfileSchema.parse(body);

    await db.update(users)
      .set({ 
        full_name: validatedData.full_name,
        updated_at: new Date()
      })
      .where(eq(users.id, user.user_id));

    await db.insert(audit_events).values({
      org_id: user.org_id,
      user_id: user.user_id,
      event_type: 'profile_updated',
      event_category: 'user_management',
      actor_type: 'user',
      actor_id: user.user_id,
      action: 'update_profile',
      description: 'User updated their profile information',
      changes: { field: 'full_name', new_value: validatedData.full_name },
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      user_agent: request.headers.get('user-agent') || 'unknown'
    });

    const [userData] = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      nickname: users.nickname,
      avatar_url: users.avatar_url,
      role: users.role,
      locale: users.locale,
      time_zone: users.time_zone,
      theme: users.theme,
      font_size: users.font_size,
      contrast_mode: users.contrast_mode,
      notification_preferences: users.notification_preferences,
      status: users.status,
      email_verified: users.email_verified,
      last_login_at: users.last_login_at,
      created_at: users.created_at,
      organization: {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        plan_tier: organizations.plan_tier,
        home_region: organizations.home_region,
        currency: organizations.currency,
        onboarding_completed: organizations.onboarding_completed,
      }
    })
    .from(users)
    .innerJoin(organizations, eq(users.org_id, organizations.id))
    .where(eq(users.id, user.user_id))
    .limit(1);

    return createApiResponse(userData);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Validation failed', 400, ApiErrorCode.VALIDATION_ERROR, error.errors.map(e => e.message));
    }
    console.error('Error updating profile:', error);
    return createErrorResponse('Failed to update profile', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function GET(request: NextRequest) {
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
    const [userData] = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      nickname: users.nickname,
      avatar_url: users.avatar_url,
      role: users.role,
      locale: users.locale,
      time_zone: users.time_zone,
      theme: users.theme,
      font_size: users.font_size,
      contrast_mode: users.contrast_mode,
      notification_preferences: users.notification_preferences,
      status: users.status,
      email_verified: users.email_verified,
      last_login_at: users.last_login_at,
      created_at: users.created_at,
      organization: {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        plan_tier: organizations.plan_tier,
        home_region: organizations.home_region,
        currency: organizations.currency,
        onboarding_completed: organizations.onboarding_completed,
      }
    })
    .from(users)
    .innerJoin(organizations, eq(users.org_id, organizations.id))
    .where(eq(users.id, user.user_id))
    .limit(1);

    if (!userData) {
      return createErrorResponse('User not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    return createApiResponse(userData);
  } catch (error: any) {
    console.error('Error fetching user data:', error);
    return createErrorResponse('Failed to fetch user data', 500, ApiErrorCode.DATABASE_ERROR);
  }
}