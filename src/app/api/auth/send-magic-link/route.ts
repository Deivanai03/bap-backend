import { NextRequest } from 'next/server';
import { generateMagicLink } from '../../../../lib/auth/magic-link';
import { sendMagicLinkEmail } from '../../../../lib/email';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { checkMagicLinkRateLimit } from '../../../../lib/rate-limit/magic-link';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/send-magic-link:
 *   post:
 *     summary: Send magic link to email
 *     description: Send a magic link authentication email to the user
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
 *         description: Magic link sent successfully
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = schema.parse(body);
    
    // Email-specific rate limiting (5 per hour per email)
    const rateLimitResult = await checkMagicLinkRateLimit(email);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many magic link requests for this email. Please try again in an hour.', 429);
    }
    
    const token = await generateMagicLink(email);
    const magicLink = `${process.env.NEXTAUTH_URL}/api/auth/verify-magic-link?token=${token}`;
    
    await sendMagicLinkEmail(email, magicLink);

    // Audit log
    await logAuditEvent({
      event_type: 'auth.magic_link_sent',
      event_category: 'auth',
      actor_type: 'user',
      action: 'sent',
      description: `Magic link sent to ${email}`,
      metadata: { email, remaining: rateLimitResult.remaining },
      request
    });
    
    return createApiResponse({
      message: 'Magic link sent to your email'
    });
  } catch (error: any) {
    // Audit log for failed attempts
    await logAuditEvent({
      event_type: 'auth.magic_link_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `Magic link generation failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400);
  }
}