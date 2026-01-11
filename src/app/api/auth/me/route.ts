import { NextRequest } from 'next/server';
import { authenticateRequest } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { users, organizations } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const sessionData = await authenticateRequest(request);
    
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
      }
    })
    .from(users)
    .innerJoin(organizations, eq(users.org_id, organizations.id))
    .where(eq(users.id, sessionData.user_id))
    .limit(1);

    if (!userData) {
      return createErrorResponse('User not found', 404);
    }

    return createApiResponse(userData);
  } catch (error: any) {
    return createErrorResponse(error.message, 401);
  }
}