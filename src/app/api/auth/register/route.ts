import { NextRequest } from 'next/server';
import { createOrganization } from '../../../../lib/services/organization';
import { generateMagicLink } from '../../../../lib/auth/magic-link';
import { sendMagicLinkEmail } from '../../../../lib/email';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(255).trim(),
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  organization_name: z.string().min(2, 'Organization name must be at least 2 characters').max(255).trim(),
  home_region: z.enum(['IN', 'EU', 'US', 'ROW', 'SEA'], {
    message: 'Invalid home region'
  }),
  billing_country: z.string().length(2, 'Billing country must be 2 characters').toUpperCase(),
  currency: z.string().length(3, 'Currency must be 3 characters').toUpperCase(),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many requests. Please try again later.', 429);
    }

    const body = await request.json();
    const data = schema.parse(body);
    
    // Create organization and owner
    const { organization, owner } = await createOrganization({
      name: data.organization_name,
      billing_email: data.email,
      home_region: data.home_region,
      billing_country: data.billing_country,
      currency: data.currency,
      owner_email: data.email,
      owner_name: data.full_name,
    });

    // Generate magic link for email verification
    const token = await generateMagicLink(data.email);
    const magicLink = `${process.env.NEXTAUTH_URL}/api/auth/verify-magic-link?token=${token}`;
    
    await sendMagicLinkEmail(data.email, magicLink);

    // Audit log
    await logAuditEvent({
      org_id: organization.id,
      user_id: owner.id,
      event_type: 'org.created',
      event_category: 'org',
      actor_type: 'user',
      actor_id: owner.id,
      resource_type: 'organization',
      resource_id: organization.id,
      action: 'created',
      description: `Organization "${data.organization_name}" created with owner ${data.email}`,
      metadata: { home_region: data.home_region, billing_country: data.billing_country },
      request
    });

    return createApiResponse({
      message: 'Organization created successfully. Check your email to verify and sign in.',
      organization_id: organization.id,
    });
  } catch (error: any) {
    // Audit log for failed registration
    await logAuditEvent({
      event_type: 'org.creation_failed',
      event_category: 'security',
      actor_type: 'user',
      action: 'failed',
      description: `Organization creation failed: ${error.message}`,
      metadata: { error: error.message },
      request
    });

    return createErrorResponse(error.message, 400);
  }
}