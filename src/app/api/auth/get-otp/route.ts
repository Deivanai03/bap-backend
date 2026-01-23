import { NextRequest } from 'next/server';
import { getOTPFromToken } from '../../../../lib/auth/magic-link';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import jwt from 'jsonwebtoken';

// Function to generate OTP from JWT token content
function generateOTPFromJWT(jwtContent: string): string {
  // Generate deterministic OTP from JWT content
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(jwtContent).digest('hex');
  // Take first 6 digits from hash and ensure it's 6 digits
  const otp = parseInt(hash.substring(0, 8), 16) % 1000000;
  return otp.toString().padStart(6, '0');
}

async function getOTPFromAnyToken(token: string): Promise<string> {
  try {
    // First, try to decode as JWT (registration token)
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (decoded.type === 'registration') {
      // Generate OTP from JWT content
      return generateOTPFromJWT(token);
    }
  } catch (error) {
    // Not a JWT or invalid JWT, try database lookup (login token)
    try {
      return await getOTPFromToken(token);
    } catch (dbError) {
      throw new Error('Invalid or expired token');
    }
  }
  
  throw new Error('Invalid token type');
}

/**
 * @swagger
 * /api/auth/get-otp:
 *   get:
 *     summary: Get OTP from magic link token
 *     description: Extract the 6-digit OTP code from a magic link token for manual entry
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Magic link token from email
 *         example: abc123def456
 *     responses:
 *       200:
 *         description: OTP retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     otp:
 *                       type: string
 *                       example: "123456"
 *                       description: 6-digit OTP code
 *                 meta:
 *                   $ref: '#/components/schemas/ApiResponse/properties/meta'
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid or expired token
 *       429:
 *         description: Rate limit exceeded
 */
export async function OPTIONS() {
  return handleOptions();
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many requests', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
    }

    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    
    if (!token) {
      return createErrorResponse('Token parameter is required', 400, ApiErrorCode.MISSING_REQUIRED_FIELD);
    }
    
    const otp = await getOTPFromAnyToken(token);
    
    // Audit log
    await logAuditEvent({
      event_type: 'auth.otp_retrieved',
      event_category: 'auth',
      actor_type: 'user',
      action: 'retrieved',
      description: 'OTP code retrieved from magic link token',
      metadata: { token_length: token.length },
      request
    });
    
    return createApiResponse({
      otp
    });
  } catch (error: any) {
    // Audit log for failed attempts
    await logAuditEvent({
      event_type: 'auth.otp_retrieval_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `OTP retrieval failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400, ApiErrorCode.INVALID_TOKEN);
  }
}
