import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { input_envelopes } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/input-agent/text:
 *   post:
 *     summary: Process text input
 *     description: Process text input through the input agent
 *     tags: [Input Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *               - session_id
 *             properties:
 *               text:
 *                 type: string
 *                 minLength: 1
 *               session_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Text processed successfully
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
 *                         envelope:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             inputType:
 *                               type: string
 *                             content:
 *                               type: object
 *                             status:
 *                               type: string
 *                             createdAt:
 *                               type: string
 *                               format: date-time
 *       400:
 *         description: Invalid input data
 */

const textInputSchema = z.object({
  text: z.string().min(1),
  session_id: z.string()
});

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
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
    const body = await request.json();
    const validatedData = textInputSchema.parse(body);
    const { text, session_id } = validatedData;

    const clientInfo = {
      user_agent: request.headers.get('user-agent') || undefined,
      ip_address: request.headers.get('x-forwarded-for') || 
        request.headers.get('x-real-ip') || undefined,
    };

    // Create input envelope
    const [envelope] = await db
      .insert(input_envelopes)
      .values({
        org_id: user.org_id,
        user_id: user.id,
        input_type: 'text',
        content: {
          text,
          session_id,
          client_info: clientInfo
        },
        status: 'pending'
      })
      .returning();

    // TODO: Process the text input with your AI service
    // For now, just mark as completed
    await db
      .update(input_envelopes)
      .set({ 
        status: 'completed',
        processed_at: new Date()
      })
      .where(eq(input_envelopes.id, envelope.id));

    return createApiResponse({ 
      envelope: {
        id: envelope.id,
        inputType: envelope.input_type,
        content: envelope.content,
        status: 'completed',
        createdAt: envelope.created_at
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error processing text input:', error);
    return createErrorResponse('Failed to process text input', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
