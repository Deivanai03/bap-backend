import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { chats, chat_participants, users } from '../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/chats/{chatId}:
 *   get:
 *     summary: Get specific chat
 *     description: Retrieve details of a specific chat
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Chat retrieved successfully
 *       404:
 *         description: Chat not found
 *   put:
 *     summary: Update chat
 *     description: Update chat settings like title, pin status, or mute status
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
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
 *               title:
 *                 type: string
 *               isPinned:
 *                 type: boolean
 *               isMuted:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Chat updated successfully
 *       404:
 *         description: Chat not found
 *   delete:
 *     summary: Delete chat
 *     description: Delete a chat (only creator can delete)
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Chat deleted successfully
 *       404:
 *         description: Chat not found or unauthorized
 */

const updateChatSchema = z.object({
  title: z.string().optional(),
  isPinned: z.boolean().optional(),
  isMuted: z.boolean().optional()
});

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(
  request: NextRequest,
  { params }: { params: { chatId: string } }
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
  const { chatId } = params;

  try {
    // Get chat with participants
    const chatData = await db
      .select({
        id: chats.id,
        title: chats.title,
        type: chats.type,
        createdBy: chats.created_by,
        lastMessageAt: chats.last_message_at,
        createdAt: chats.created_at,
        participants: {
          id: users.id,
          fullName: users.full_name,
          email: users.email,
          avatarUrl: users.avatar_url,
          onlineStatus: users.online_status,
          lastSeen: users.last_seen
        }
      })
      .from(chats)
      .innerJoin(chat_participants, eq(chats.id, chat_participants.chat_id))
      .innerJoin(users, eq(chat_participants.user_id, users.id))
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.org_id, user.org_id)
        )
      );

    if (chatData.length === 0) {
      return createErrorResponse('Chat not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Check if user is participant
    const isParticipant = chatData.some(row => row.participants.id === user.id);
    if (!isParticipant) {
      return createErrorResponse('Chat not found', 404, ApiErrorCode.INSUFFICIENT_PERMISSIONS);
    }

    // Group participants
    const chat = {
      id: chatData[0].id,
      title: chatData[0].title,
      type: chatData[0].type,
      createdBy: chatData[0].createdBy,
      lastMessageAt: chatData[0].lastMessageAt,
      createdAt: chatData[0].createdAt,
      participants: chatData.map(row => row.participants)
    };

    return createApiResponse({ chat });
  } catch (error) {
    return createErrorResponse('Failed to fetch chat', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { chatId: string } }
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
  const { chatId } = params;

  try {
    const body = await request.json();
    const validatedData = updateChatSchema.parse(body);
    const { title, isPinned, isMuted } = validatedData;

    // Verify user is participant
    const participant = await db
      .select()
      .from(chat_participants)
      .innerJoin(chats, eq(chat_participants.chat_id, chats.id))
      .where(
        and(
          eq(chat_participants.chat_id, chatId),
          eq(chat_participants.user_id, user.id),
          eq(chats.org_id, user.org_id)
        )
      )
      .limit(1);

    if (participant.length === 0) {
      return createErrorResponse('Chat not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Update chat and participant settings
    await db.transaction(async (tx) => {
      // Update chat title if provided
      if (title !== undefined) {
        await tx
          .update(chats)
          .set({ title, updated_at: new Date() })
          .where(eq(chats.id, chatId));
      }

      // Update participant settings if provided
      const participantUpdates: any = {};
      if (isPinned !== undefined) participantUpdates.is_pinned = isPinned;
      if (isMuted !== undefined) participantUpdates.is_muted = isMuted;

      if (Object.keys(participantUpdates).length > 0) {
        await tx
          .update(chat_participants)
          .set(participantUpdates)
          .where(
            and(
              eq(chat_participants.chat_id, chatId),
              eq(chat_participants.user_id, user.id)
            )
          );
      }
    });

    return createApiResponse({ message: 'Chat updated successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    return createErrorResponse('Failed to update chat', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { chatId: string } }
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
  const { chatId } = params;

  try {
    // Verify user is creator or participant
    const chat = await db
      .select()
      .from(chats)
      .innerJoin(chat_participants, eq(chats.id, chat_participants.chat_id))
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.org_id, user.org_id),
          eq(chat_participants.user_id, user.id)
        )
      )
      .limit(1);

    if (chat.length === 0) {
      return createErrorResponse('Chat not found or unauthorized', 404, ApiErrorCode.INSUFFICIENT_PERMISSIONS);
    }

    // Delete chat (cascade will handle participants and messages)
    await db.delete(chats).where(eq(chats.id, chatId));

    return createApiResponse({ message: 'Chat deleted successfully' });
  } catch (error) {
    return createErrorResponse('Failed to delete chat', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
