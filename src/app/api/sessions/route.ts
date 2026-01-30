import { NextRequest } from 'next/server';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { getUserActiveSessions, revokeSession } from '../../../lib/auth/session';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
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
    const sessions = await getUserActiveSessions(user.user_id);
    
    const formattedSessions = sessions.map(session => {
      // Format device name
      const deviceName = session.device_name || `${session.browser} on ${session.os}`;
      
      // Format location from IP or stored location
      let locationText = 'Unknown location';
      if (session.location && session.location.city && session.location.country) {
        locationText = `${session.location.city}, ${session.location.country}`;
      } else if (session.ip_address) {
        locationText = `IP: ${session.ip_address}`;
      }
      
      // Format last activity
      const lastActivity = new Date(session.last_activity_at);
      const now = new Date();
      const diffMs = now.getTime() - lastActivity.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);
      
      let lastActiveText;
      if (diffHours < 1) {
        lastActiveText = 'Active now';
      } else if (diffHours < 24) {
        lastActiveText = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      } else {
        lastActiveText = lastActivity.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      return {
        id: session.id,
        device_name: deviceName,
        location: locationText,
        ip_address: session.ip_address,
        last_active: lastActiveText,
        last_activity_at: session.last_activity_at,
        created_at: session.created_at,
        device_type: session.device_type,
        browser: session.browser,
        os: session.os
      };
    });

    return createApiResponse(formattedSessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    return createErrorResponse('Failed to fetch sessions', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
