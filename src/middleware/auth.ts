import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '../lib/auth/session';
import { verifyToken } from '../lib/auth/jwt';
import { setTenantContext } from '../lib/db';
import { SessionData, AuthError, DeviceInfo } from '../types';

export interface AuthenticatedRequest extends NextRequest {
  user: SessionData;
}

export async function authenticateRequest(request: NextRequest): Promise<SessionData> {
  const authHeader = request.headers.get('authorization');
  const sessionCookie = request.cookies.get('session_token')?.value;
  
  let sessionData: SessionData | null = null;

  // Try JWT token first (Bearer token)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    
    if (payload && payload.sessionToken && payload.orgId) {
      // Set tenant context BEFORE validating session
      await setTenantContext(payload.orgId as string);
      
      // Now validate the session token from JWT
      sessionData = await validateSession(payload.sessionToken as string);
    }
  }
  
  // Fallback to session token from cookie
  if (!sessionData && sessionCookie) {
    sessionData = await validateSession(sessionCookie);
    
    // Set tenant context after getting session data
    if (sessionData) {
      await setTenantContext(sessionData.org_id);
    }
  }

  if (!sessionData) {
    throw new AuthError('Invalid or expired session', 'INVALID_SESSION', 401);
  }

  return sessionData;
}

export function withAuth(handler: (req: AuthenticatedRequest) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await authenticateRequest(request);
      
      // Add user to request object
      (request as AuthenticatedRequest).user = user;
      
      return await handler(request as AuthenticatedRequest);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          },
          { status: error.status }
        );
      }

      console.error('Authentication error:', error);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        },
        { status: 500 }
      );
    }
  };
}

export function requireRole(allowedRoles: string[]) {
  return function(handler: (req: AuthenticatedRequest) => Promise<NextResponse>) {
    return withAuth(async (request: AuthenticatedRequest): Promise<NextResponse> => {
      if (!allowedRoles.includes(request.user.role)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Insufficient permissions for this action',
            },
          },
          { status: 403 }
        );
      }

      return await handler(request);
    });
  };
}

export function extractDeviceInfo(request: NextRequest): DeviceInfo {
  const userAgent = request.headers.get('user-agent') || '';
  const ip = request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             request.ip;

  // Simple device detection
  const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
  const isTablet = /iPad|Tablet/.test(userAgent);
  
  let deviceType = 'desktop';
  if (isTablet) deviceType = 'tablet';
  else if (isMobile) deviceType = 'mobile';

  // Extract browser info
  let browser = 'unknown';
  if (userAgent.includes('Chrome')) browser = 'chrome';
  else if (userAgent.includes('Firefox')) browser = 'firefox';
  else if (userAgent.includes('Safari')) browser = 'safari';
  else if (userAgent.includes('Edge')) browser = 'edge';

  // Extract OS info
  let os = 'unknown';
  if (userAgent.includes('Windows')) os = 'windows';
  else if (userAgent.includes('Mac')) os = 'macos';
  else if (userAgent.includes('Linux')) os = 'linux';
  else if (userAgent.includes('Android')) os = 'android';
  else if (userAgent.includes('iOS')) os = 'ios';

  return {
    device_type: deviceType,
    device_name: `${browser} on ${os}`,
    os,
    browser,
    ip_address: ip,
    user_agent: userAgent,
  };
}