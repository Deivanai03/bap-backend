import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/user/complete-onboarding:
 *   post:
 *     summary: Complete user onboarding
 *     description: Complete the onboarding process for the authenticated user
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
 *               - fullName
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *               preferences:
 *                 type: object
 *                 properties:
 *                   theme:
 *                     type: string
 *                     enum: [system, dark, light]
 *                   fontSize:
 *                     type: string
 *                     enum: [small, default, large]
 *                   notifications:
 *                     type: object
 *     responses:
 *       200:
 *         description: Onboarding completed successfully
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
 *                         user:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             fullName:
 *                               type: string
 *                             email:
 *                               type: string
 *                             avatarUrl:
 *                               type: string
 *                             onboardingCompleted:
 *                               type: boolean
 *       400:
 *         description: Invalid input data
 */

const completeOnboardingSchema = z.object({
  fullName: z.string().min(1).max(255),
  avatarUrl: z.string().url().optional(),
  preferences: z.object({
    theme: z.enum(['system', 'dark', 'light']).optional(),
    fontSize: z.enum(['small', 'default', 'large']).optional(),
    notifications: z.record(z.any()).optional()
  }).optional()
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
    const validatedData = completeOnboardingSchema.parse(body);
    const { fullName, avatarUrl, preferences } = validatedData;

    // Update user with onboarding data
    const updateData: any = {
      full_name: fullName,
      onboarding_completed: true,
      updated_at: new Date()
    };

    if (avatarUrl) {
      updateData.avatar_url = avatarUrl;
    }

    if (preferences) {
      if (preferences.theme) {
        updateData.theme = preferences.theme;
      }
      if (preferences.fontSize) {
        updateData.font_size = preferences.fontSize;
      }
      if (preferences.notifications) {
        updateData.notification_preferences = preferences.notifications;
      }
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, user.id))
      .returning({
        id: users.id,
        fullName: users.full_name,
        email: users.email,
        avatarUrl: users.avatar_url,
        onboardingCompleted: users.onboarding_completed
      });

    return createApiResponse({ user: updatedUser });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error completing onboarding:', error);
    return createErrorResponse('Failed to complete onboarding', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
