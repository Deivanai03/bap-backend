import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { input_envelopes } from '../../../../lib/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';

/**
 * @swagger
 * /api/input-agent/envelope:
 *   get:
 *     summary: Get input envelopes
 *     description: Retrieve input envelopes for the authenticated user
 *     tags: [Input Agent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [text, voice, image, document]
 *         description: Filter by input type
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Envelopes retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         envelopes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               inputType:
 *                                 type: string
 *                               content:
 *                                 type: object
 *                               status:
 *                                 type: string
 *                               processedAt:
 *                                 type: string
 *                                 format: date-time
 *                               createdAt:
 *                                 type: string
 *                                 format: date-time
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             page:
 *                               type: integer
 *                             limit:
 *                               type: integer
 *                             total:
 *                               type: integer
 *                             totalPages:
 *                               type: integer
 */

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Build where conditions
    let whereConditions = [
      eq(input_envelopes.user_id, user.id),
      eq(input_envelopes.org_id, user.org_id)
    ];
    
    if (type) {
      whereConditions.push(eq(input_envelopes.input_type, type as any));
    }

    // Get envelopes
    const envelopes = await db
      .select({
        id: input_envelopes.id,
        inputType: input_envelopes.input_type,
        content: input_envelopes.content,
        status: input_envelopes.status,
        processedAt: input_envelopes.processed_at,
        createdAt: input_envelopes.created_at
      })
      .from(input_envelopes)
      .where(and(...whereConditions))
      .orderBy(desc(input_envelopes.created_at))
      .limit(limit)
      .offset((page - 1) * limit);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(input_envelopes)
      .where(and(...whereConditions));

    const total = totalResult.count;

    return createApiResponse({
      envelopes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching envelopes:', error);
    return createErrorResponse('Failed to fetch envelopes', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
