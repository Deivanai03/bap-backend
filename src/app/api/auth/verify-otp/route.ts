import { NextRequest } from 'next/server';
import { verifyOTPAndCreateSession } from '../../../../lib/auth/magic-link';
import { verifyTokenAndCreateSession } from '../../../../lib/auth/jwt-magic-link';
import { extractDeviceInfo } from '../../../../middleware/auth';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// Function to generate OTP from JWT token content (same as get-otp)
function generateOTPFromJWT(jwtContent: string): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(jwtContent).digest('hex');
  const otp = parseInt(hash.substring(0, 8), 16) % 1000000;
  return otp.toString().padStart(6, '0');
}

async function verifyOTPFromAnyToken(email: string, otp: string, token: string, context: any) {
  try {
    // First, try to decode as JWT (registration token)
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (decoded.type === 'registration' && decoded.email === email) {
      // Generate OTP from JWT and compare
      const expectedOTP = generateOTPFromJWT(token);
      if (otp === expectedOTP) {
        // Valid registration OTP - create user and session
        return await verifyTokenAndCreateSession(token, context);
      } else {
        throw new Error('Invalid OTP');
      }
    }
  } catch (error: any) {
    // Not a JWT or invalid JWT, try database lookup (login token)
    return await verifyOTPAndCreateSession(email, otp, context);
  }
  
  throw new Error('Invalid token or OTP');
}

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP code
 *     description: Authenticate user with 6-digit OTP code and create session
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: <your-email@gmail.com>
 *               otp:
 *                 type: string
 *                 pattern: '^[0-9]{6}$'
 *                 example: "123456"
 *                 description: 6-digit OTP code
 *     responses:
 *       200:
 *         description: Authentication successful, returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid email, OTP, or expired code
 *       429:
 *         description: Rate limit exceeded
 */
const schema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits').trim(),
  token: z.string().optional(), // Optional token for registration flow
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many requests', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
    }

    const body = await request.json();
    const { email, otp, token } = schema.parse(body);
    
    const deviceInfo = extractDeviceInfo(request);
    
    let sessionResult;
    if (token) {
      // Use unified verification for both JWT and database tokens
      sessionResult = await verifyOTPFromAnyToken(email, otp, token, deviceInfo);
    } else {
      // Fallback to database-only verification (existing login flow)
      sessionResult = await verifyOTPAndCreateSession(email, otp, deviceInfo);
    }
    
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
      event_type: 'auth.otp_login_success',
      event_category: 'auth',
      actor_type: 'user',
      actor_id: sessionResult.user.id,
      action: 'login',
      description: `User ${sessionResult.user.email} logged in successfully via OTP`,
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
      event_type: 'auth.otp_login_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `OTP login attempt failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400, ApiErrorCode.INVALID_OTP);
  }
}
