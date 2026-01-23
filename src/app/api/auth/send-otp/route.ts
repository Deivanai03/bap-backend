import { NextRequest } from 'next/server';
import { generateMagicLink } from '../../../../lib/auth/magic-link';
import { sendMagicLinkEmail } from '../../../../lib/email';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { checkMagicLinkRateLimit } from '../../../../lib/rate-limit/magic-link';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/send-otp:
 *   post:
 *     summary: Send magic link with OTP
 *     description: Send a magic link authentication email that contains an associated OTP code (extractable via get-otp endpoint)
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
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: <your-email@gmail.com>
 *     responses:
 *       200:
 *         description: Magic link sent successfully (contains extractable OTP)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid email or validation error
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
const schema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = schema.parse(body);
    
    // Email-specific rate limiting (5 per hour per email)
    const rateLimitResult = await checkMagicLinkRateLimit(email);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many magic link requests for this email. Please try again in an hour.', 429, ApiErrorCode.RATE_LIMIT_EXCEEDED);
    }
    
    const token = await generateMagicLink(email);
    const magicLink = `${process.env.NEXTAUTH_URL}/verify-email?token=${token}`;
    
    await sendMagicLinkEmail(email, magicLink);

    // Audit log
    await logAuditEvent({
      event_type: 'auth.otp_sent',
      event_category: 'auth',
      actor_type: 'user',
      action: 'sent',
      description: `OTP magic link sent to ${email}`,
      metadata: { email, remaining: rateLimitResult.remaining },
      request
    });
    
    return createApiResponse({
      message: 'Magic link sent to your email'
    });
  } catch (error: any) {
    // Audit log for failed attempts
    await logAuditEvent({
      event_type: 'auth.otp_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `OTP generation failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400, ApiErrorCode.INVALID_INPUT);
  }
}
