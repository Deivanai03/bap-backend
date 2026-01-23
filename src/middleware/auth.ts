import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '../lib/auth/session';
import { verifyToken } from '../lib/auth/jwt';
import { setTenantContext } from '../lib/db';
import { SessionData, AuthError, DeviceInfo } from '../types';
import { corsHeaders } from '../lib/api/cors';

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
          { status: error.status, headers: corsHeaders() }
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
        { status: 500, headers: corsHeaders() }
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
          { status: 403, headers: corsHeaders() }
        );
      }

      return await handler(request);
    });
  };
}

export function extractDeviceInfo(request: NextRequest, deviceData?: any): DeviceInfo {
  const userAgent = request.headers.get('user-agent') || '';
  const ip = request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             request.ip;

  // If frontend provides device data, use it
  if (deviceData) {
    return {
      device_id: deviceData.device_id,
      device_type: detectDeviceType(deviceData.user_agent || userAgent),
      device_name: `${detectBrowser(deviceData.user_agent || userAgent)} on ${detectOS(deviceData.user_agent || userAgent)}`,
      os: detectOS(deviceData.user_agent || userAgent),
      browser: detectBrowser(deviceData.user_agent || userAgent),
      ip_address: ip,
      user_agent: deviceData.user_agent || userAgent,
    };
  }

  // Fallback to basic detection from headers
  return {
    device_type: detectDeviceType(userAgent),
    device_name: `${detectBrowser(userAgent)} on ${detectOS(userAgent)}`,
    os: detectOS(userAgent),
    browser: detectBrowser(userAgent),
    ip_address: ip,
    user_agent: userAgent,
  };
}

function detectDeviceType(userAgent: string): string {
  const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
  const isTablet = /iPad|Tablet/.test(userAgent);
  
  if (isTablet) return 'tablet';
  if (isMobile) return 'mobile';
  return 'desktop';
}

function detectBrowser(userAgent: string): string {
  if (userAgent.includes('Chrome')) return 'chrome';
  if (userAgent.includes('Firefox')) return 'firefox';
  if (userAgent.includes('Safari')) return 'safari';
  if (userAgent.includes('Edge')) return 'edge';
  return 'unknown';
}

function detectOS(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'windows';
  if (userAgent.includes('Mac')) return 'macos';
  if (userAgent.includes('Linux')) return 'linux';
  if (userAgent.includes('Android')) return 'android';
  if (userAgent.includes('iOS')) return 'ios';
  return 'unknown';
}