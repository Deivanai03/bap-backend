import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { db } from '../../../lib/db';
import { labels, chat_labels } from '../../../lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/labels:
 *   get:
 *     summary: Get all labels for authenticated user
 *     description: Retrieve all labels created by the user
 *     tags: [Labels]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Labels retrieved successfully
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
 *                         labels:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               color:
 *                                 type: string
 *                               chatIds:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *   post:
 *     summary: Create a new label
 *     description: Create a new label for organizing chats
 *     tags: [Labels]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - color
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *               color:
 *                 type: string
 *                 pattern: '^#[0-9A-Fa-f]{6}$'
 *     responses:
 *       201:
 *         description: Label created successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Label with this name already exists
 */

const createLabelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
});

// OPTIONS handler removed - server handles CORS globally

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
    // Get labels with associated chat IDs
    const userLabels = await db
      .select({
        id: labels.id,
        name: labels.name,
        color: labels.color,
        createdAt: labels.created_at,
        chatId: chat_labels.chat_id
      })
      .from(labels)
      .leftJoin(chat_labels, eq(labels.id, chat_labels.label_id))
      .where(
        and(
          eq(labels.user_id, user.id),
          eq(labels.org_id, user.org_id)
        )
      )
      .orderBy(asc(labels.name));

    // Group chat IDs by label
    const labelsMap = new Map();
    userLabels.forEach(row => {
      if (!labelsMap.has(row.id)) {
        labelsMap.set(row.id, {
          id: row.id,
          name: row.name,
          color: row.color,
          createdAt: row.createdAt,
          chatIds: []
        });
      }
      if (row.chatId) {
        labelsMap.get(row.id).chatIds.push(row.chatId);
      }
    });

    const transformedLabels = Array.from(labelsMap.values());

    return createApiResponse({ labels: transformedLabels });
  } catch (error) {
    console.error('Error fetching labels:', error);
    return createErrorResponse('Failed to fetch labels', 500, ApiErrorCode.DATABASE_ERROR);
  }
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
    const validatedData = createLabelSchema.parse(body);
    const { name, color } = validatedData;

    // Check if label with same name exists for user
    const existingLabel = await db
      .select()
      .from(labels)
      .where(
        and(
          eq(labels.user_id, user.id),
          eq(labels.org_id, user.org_id),
          eq(labels.name, name)
        )
      )
      .limit(1);

    if (existingLabel.length > 0) {
      return createErrorResponse('Label with this name already exists', 409, ApiErrorCode.INVALID_INPUT);
    }

    // Create label
    const [newLabel] = await db
      .insert(labels)
      .values({
        org_id: user.org_id,
        user_id: user.id,
        name,
        color
      })
      .returning();

    const labelResponse = {
      id: newLabel.id,
      name: newLabel.name,
      color: newLabel.color,
      chatIds: []
    };

    return createApiResponse({ label: labelResponse }, true, []);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error creating label:', error);
    return createErrorResponse('Failed to create label', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
