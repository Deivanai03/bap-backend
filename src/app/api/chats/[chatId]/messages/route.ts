import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../../lib/api/response';
import { handleOptions } from '../../../../../lib/api/cors';
import { apiRateLimit } from '../../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../../middleware/auth';
import { db } from '../../../../../lib/db';
import { chats, chat_participants, messages, users } from '../../../../../lib/db/schema';
import { eq, and, desc, lt } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/chats/{chatId}/messages:
 *   get:
 *     summary: Get chat messages
 *     description: Retrieve messages for a specific chat with pagination
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Get messages before this message ID
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
 *       404:
 *         description: Chat not found
 *   post:
 *     summary: Send message
 *     description: Send a new message to the chat
 *     tags: [Messages]
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
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               messageType:
 *                 type: string
 *                 enum: [text, image, video, audio, document, system]
 *                 default: text
 *               metadata:
 *                 type: object
 *               replyToId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Chat not found
 */

const sendMessageSchema = z.object({
  content: z.string().min(1),
  messageType: z.enum(['text', 'image', 'video', 'audio', 'document', 'system']).default('text'),
  metadata: z.record(z.any()).optional(),
  replyToId: z.string().uuid().optional()
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
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const before = searchParams.get('before');

    // Verify user has access to chat
    const participant = await db
      .select()
      .from(chat_participants)
      .innerJoin(chats, eq(chat_participants.chat_id, chats.id))
      .where(
        and(
          eq(chat_participants.chat_id, chatId),
          eq(chat_participants.user_id, user.user_id),
          eq(chats.org_id, user.org_id)
        )
      )
      .limit(1);

    if (participant.length === 0) {
      return createErrorResponse('Chat not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Build query conditions
    let whereConditions = [eq(messages.chat_id, chatId)];
    if (before) {
      whereConditions.push(lt(messages.id, before));
    }

    // Get messages with sender info
    const chatMessages = await db
      .select({
        id: messages.id,
        content: messages.content,
        messageType: messages.message_type,
        metadata: messages.metadata,
        replyTo: messages.reply_to,
        createdAt: messages.created_at,
        updatedAt: messages.updated_at,
        sender: {
          id: users.id,
          fullName: users.full_name,
          email: users.email,
          avatarUrl: users.avatar_url
        }
      })
      .from(messages)
      .innerJoin(users, eq(messages.sender_id, users.id))
      .where(and(...whereConditions))
      .orderBy(desc(messages.created_at))
      .limit(limit)
      .offset((page - 1) * limit);

    // Reverse to show oldest first
    const reversedMessages = chatMessages.reverse();

    return createApiResponse({
      messages: reversedMessages,
      pagination: {
        page,
        limit,
        hasMore: chatMessages.length === limit
      }
    });
  } catch (error) {
    return createErrorResponse('Failed to fetch messages', 500, ApiErrorCode.DATABASE_ERROR);
  }
}

export async function POST(
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
    const validatedData = sendMessageSchema.parse(body);
    const { content, messageType, metadata, replyToId } = validatedData;

    // Verify user has access to chat
    const participant = await db
      .select()
      .from(chat_participants)
      .innerJoin(chats, eq(chat_participants.chat_id, chats.id))
      .where(
        and(
          eq(chat_participants.chat_id, chatId),
          eq(chat_participants.user_id, user.user_id),
          eq(chats.org_id, user.org_id)
        )
      )
      .limit(1);

    if (participant.length === 0) {
      return createErrorResponse('Chat not found', 404, ApiErrorCode.USER_NOT_FOUND);
    }

    // Create message and update chat in transaction
    const result = await db.transaction(async (tx) => {
      // Create message
      const [newMessage] = await tx
        .insert(messages)
        .values({
          chat_id: chatId,
          sender_id: user.user_id,
          content,
          message_type: messageType,
          metadata,
          reply_to: replyToId
        })
        .returning();

      // Update chat's last message timestamp
      await tx
        .update(chats)
        .set({ 
          last_message_at: new Date(),
          updated_at: new Date()
        })
        .where(eq(chats.id, chatId));

      // Get message with sender info
      const [messageWithSender] = await tx
        .select({
          id: messages.id,
          content: messages.content,
          messageType: messages.message_type,
          metadata: messages.metadata,
          replyTo: messages.reply_to,
          createdAt: messages.created_at,
          updatedAt: messages.updated_at,
          sender: {
            id: users.id,
            fullName: users.full_name,
            email: users.email,
            avatarUrl: users.avatar_url
          }
        })
        .from(messages)
        .innerJoin(users, eq(messages.sender_id, users.id))
        .where(eq(messages.id, newMessage.id));

      return messageWithSender;
    });

    // Emit WebSocket event for real-time updates
    if (global.io) {
      global.io.to(`chat:${chatId}`).emit('message:new', {
        id: result.id,
        chatId: chatId,
        content: result.content,
        messageType: result.messageType,
        createdAt: result.createdAt,
        status: 'sent',
        sender: {
          id: result.sender.id,
          name: result.sender.fullName,
          email: result.sender.email,
          avatar: result.sender.avatarUrl
        },
        replyTo: result.replyTo
      });
    }

    return createApiResponse({ message: result }, true, []);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    return createErrorResponse('Failed to send message', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
