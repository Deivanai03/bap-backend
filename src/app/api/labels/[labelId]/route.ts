import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { labels, chat_labels } from '../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/labels/{labelId}:
 *   get:
 *     summary: Get specific label
 *     description: Retrieve details of a specific label
 *     tags: [Labels]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: labelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Label retrieved successfully
 *       404:
 *         description: Label not found
 *   put:
 *     summary: Update label
 *     description: Update label name, color, or associated chats
 *     tags: [Labels]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: labelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *               color:
 *                 type: string
 *                 pattern: '^#[0-9A-Fa-f]{6}$'
 *               chatIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Label updated successfully
 *       404:
 *         description: Label not found
 *   delete:
 *     summary: Delete label
 *     description: Delete a label and remove it from all chats
 *     tags: [Labels]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: labelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Label deleted successfully
 *       404:
 *         description: Label not found
 */

const updateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color').optional(),
  chatIds: z.array(z.string().uuid()).optional()
});

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(
  request: NextRequest,
  { params }: { params: { labelId: string } }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;
  const { labelId } = params;

  try {
    // Get label with associated chat IDs
    const labelData = await db
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
          eq(labels.id, labelId),
          eq(labels.user_id, user.id),
          eq(labels.org_id, user.org_id)
        )
      );

    if (labelData.length === 0) {
      return createErrorResponse('Label not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Group chat IDs
    const label = {
      id: labelData[0].id,
      name: labelData[0].name,
      color: labelData[0].color,
      createdAt: labelData[0].createdAt,
      chatIds: labelData.filter(row => row.chatId).map(row => row.chatId)
    };

    return createApiResponse({ label });
  } catch (error) {
    console.error('Error fetching label:', error);
    return createErrorResponse('Failed to fetch label', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { labelId: string } }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;
  const { labelId } = params;

  try {
    const body = await request.json();
    const validatedData = updateLabelSchema.parse(body);
    const { name, color, chatIds } = validatedData;

    // Verify label exists and belongs to user
    const existingLabel = await db
      .select()
      .from(labels)
      .where(
        and(
          eq(labels.id, labelId),
          eq(labels.user_id, user.id),
          eq(labels.org_id, user.org_id)
        )
      )
      .limit(1);

    if (existingLabel.length === 0) {
      return createErrorResponse('Label not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Update label and chat associations in transaction
    await db.transaction(async (tx) => {
      // Update label properties if provided
      const labelUpdates: any = { updated_at: new Date() };
      if (name !== undefined) labelUpdates.name = name;
      if (color !== undefined) labelUpdates.color = color;

      if (Object.keys(labelUpdates).length > 1) { // More than just updated_at
        await tx
          .update(labels)
          .set(labelUpdates)
          .where(eq(labels.id, labelId));
      }

      // Update chat associations if provided
      if (chatIds !== undefined) {
        // Remove existing associations
        await tx
          .delete(chat_labels)
          .where(eq(chat_labels.label_id, labelId));

        // Add new associations
        if (chatIds.length > 0) {
          const chatLabelValues = chatIds.map(chatId => ({
            chat_id: chatId,
            label_id: labelId
          }));
          await tx.insert(chat_labels).values(chatLabelValues);
        }
      }
    });

    return createApiResponse({ message: 'Label updated successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    console.error('Error updating label:', error);
    return createErrorResponse('Failed to update label', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { labelId: string } }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;
  const { labelId } = params;

  try {
    // Verify label exists and belongs to user
    const existingLabel = await db
      .select()
      .from(labels)
      .where(
        and(
          eq(labels.id, labelId),
          eq(labels.user_id, user.id),
          eq(labels.org_id, user.org_id)
        )
      )
      .limit(1);

    if (existingLabel.length === 0) {
      return createErrorResponse('Label not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Delete label (cascade will handle chat_labels)
    await db.delete(labels).where(eq(labels.id, labelId));

    return createApiResponse({ message: 'Label deleted successfully' });
  } catch (error) {
    console.error('Error deleting label:', error);
    return createErrorResponse('Failed to delete label', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
