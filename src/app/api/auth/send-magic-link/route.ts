import { NextRequest } from 'next/server';
import { generateMagicLink } from '../../../../lib/auth/magic-link';
import { sendMagicLinkEmail } from '../../../../lib/email';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { checkMagicLinkRateLimit } from '../../../../lib/rate-limit/magic-link';
import { z } from 'zod';

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