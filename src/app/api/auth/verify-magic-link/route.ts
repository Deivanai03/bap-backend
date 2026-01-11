import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicLinkAndCreateSession } from '../../../../lib/auth/magic-link';
import { extractDeviceInfo } from '../../../../middleware/auth';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  token: z.string().min(1, 'Token is required').trim(),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const { token } = schema.parse(body);
    
    const deviceInfo = extractDeviceInfo(request);
    const sessionResult = await verifyMagicLinkAndCreateSession(token, deviceInfo);
    
    const response = NextResponse.json({
      success: true,
      data: {
        jwt_token: sessionResult.jwt_token,
        expires_at: sessionResult.expires_at.toISOString(),
        user: sessionResult.user
      }
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

    return NextResponse.json({
      success: false,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message
      }
    }, { status: 400 });
  }
}