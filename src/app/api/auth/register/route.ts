import { NextRequest } from 'next/server';
import { generateRegistrationToken } from '../../../../lib/auth/jwt-magic-link';
import { sendMagicLinkEmail } from '../../../../lib/email';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { logAuditEvent } from '../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register new organization and user
 *     description: Create a new organization with the first user as owner
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - full_name
 *               - email
 *               - organization_name
 *               - home_region
 *               - billing_country
 *               - currency
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: <your-email@gmail.com>
 *               organization_name:
 *                 type: string
 *                 example: Acme Corp
 *               home_region:
 *                 type: string
 *                 enum: [IN, EU, US, ROW, SEA]
 *                 example: IN
 *               billing_country:
 *                 type: string
 *                 example: IN
 *               currency:
 *                 type: string
 *                 example: INR
 *     responses:
 *       201:
 *         description: Organization and user created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid request data
 *       409:
 *         description: Email already exists
 *       429:
 *         description: Rate limit exceeded
 */
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

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Too many requests. Please try again later.', 429);
    }

    const body = await request.json();
    const data = schema.parse(body);
    
    // Check if user already exists with this email
    const [existingUser] = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);
    
    if (existingUser) {
      return createErrorResponse('User already exists with this email. Please use magic link to sign in.', 409);
    }
    
    // Generate JWT token with registration data
    const token = await generateRegistrationToken({
      email: data.email,
      full_name: data.full_name,
      organization_name: data.organization_name,
      home_region: data.home_region,
      billing_country: data.billing_country,
      currency: data.currency
    });
    
    const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    
    await sendMagicLinkEmail(data.email, magicLink);

    // Audit log
    await logAuditEvent({
      event_type: 'auth.registration_initiated',
      event_category: 'auth',
      actor_type: 'user',
      action: 'initiated',
      description: `Registration initiated for ${data.email}`,
      metadata: { email: data.email, organization_name: data.organization_name },
      request
    });

    return createApiResponse({
      message: 'Registration link sent to your email. Please verify to complete registration.'
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