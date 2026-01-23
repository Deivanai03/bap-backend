import { NextRequest } from 'next/server';
import { authenticateRequest } from '../../../../../middleware/auth';
import { db } from '../../../../../lib/db';
import { organizations, users } from '../../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { createApiResponse, createErrorResponse } from '../../../../../lib/api/response';
import { handleOptions } from '../../../../../lib/api/cors';
import { z } from 'zod';

/**
 * @swagger
 * /api/auth/onboarding/complete:
 *   post:
 *     summary: Complete onboarding process
 *     description: Update organization and user data collected during onboarding
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - display_name
 *               - industry
 *               - company_size
 *               - tax_profile
 *               - compliance_profile
 *               - plan_tier
 *               - nickname
 *             properties:
 *               display_name:
 *                 type: string
 *                 description: Public company name
 *                 example: "Acme Corp"
 *               industry:
 *                 type: string
 *                 description: Industry sector
 *                 example: "Technology"
 *               company_size:
 *                 type: string
 *                 description: Employee count range
 *                 enum: ["1-10", "11-50", "51-200", "201-1000", "1000+"]
 *                 example: "11-50"
 *               tax_profile:
 *                 type: string
 *                 description: Tax handling preference
 *                 enum: ["NONE", "BASIC", "ADVANCED"]
 *                 example: "BASIC"
 *               compliance_profile:
 *                 type: string
 *                 description: Compliance requirements
 *                 enum: ["DEFAULT", "GDPR", "HIPAA", "SOX"]
 *                 example: "GDPR"
 *               plan_tier:
 *                 type: string
 *                 description: Subscription plan tier
 *                 enum: ["FREE", "PRO", "BUSINESS", "ENTERPRISE"]
 *                 example: "PRO"
 *               tax_id:
 *                 type: string
 *                 description: Tax identification number
 *                 example: "12-3456789"
 *               billing_address:
 *                 type: object
 *                 description: Complete billing address
 *                 properties:
 *                   street:
 *                     type: string
 *                     example: "123 Main St"
 *                   city:
 *                     type: string
 *                     example: "New York"
 *                   state:
 *                     type: string
 *                     example: "NY"
 *                   postal_code:
 *                     type: string
 *                     example: "10001"
 *                   country:
 *                     type: string
 *                     example: "US"
 *               nickname:
 *                 type: string
 *                 description: User display nickname
 *                 example: "John"
 *     responses:
 *       200:
 *         description: Onboarding completed successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 */

const schema = z.object({
  // Organization fields
  display_name: z.string().min(1, 'Display name is required').max(255),
  industry: z.string().min(1, 'Industry is required').max(100),
  company_size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']),
  tax_profile: z.enum(['NONE', 'BASIC', 'ADVANCED']),
  compliance_profile: z.enum(['DEFAULT', 'GDPR', 'HIPAA', 'SOX']),
  plan_tier: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  tax_id: z.string().max(100).optional(),
  billing_address: z.object({
    street: z.string().min(1, 'Street address is required'),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    postal_code: z.string().min(1, 'Postal code is required'),
    country: z.string().length(2, 'Country must be 2-letter code'),
  }).optional(),
  
  // User fields
  nickname: z.string().min(1, 'Nickname is required').max(100),
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    const sessionData = await authenticateRequest(request);
    const body = await request.json();
    const data = schema.parse(body);
    
    // Update organization data
    await db.update(organizations)
      .set({
        display_name: data.display_name,
        industry: data.industry,
        company_size: data.company_size,
        tax_profile: data.tax_profile,
        compliance_profile: data.compliance_profile,
        plan_tier: data.plan_tier,
        tax_id: data.tax_id || null,
        billing_address: data.billing_address || null,
        onboarding_completed: true,
        updated_at: new Date(),
      })
      .where(eq(organizations.id, sessionData.org_id));
    
    // Update user data
    await db.update(users)
      .set({
        nickname: data.nickname,
        updated_at: new Date(),
      })
      .where(eq(users.id, sessionData.user_id));
    
    return createApiResponse({
      message: 'Onboarding completed successfully',
      onboarding_completed: true,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return createErrorResponse(
        `Validation error: ${error.errors.map((e: any) => e.message).join(', ')}`,
        400
      );
    }
    return createErrorResponse(error.message, 400);
  }
}
