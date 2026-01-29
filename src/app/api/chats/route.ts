import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { db } from '../../../lib/db';
import { chats, chat_participants, users, messages } from '../../../lib/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';

/**
 * @swagger
 * /api/chats:
 *   get:
 *     summary: Get all chats for authenticated user
 *     description: Retrieve all chats where the user is a participant
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Chats retrieved successfully
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
 *                         chats:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               title:
 *                                 type: string
 *                               type:
 *                                 type: string
 *                                 enum: [direct, group]
 *                               isPinned:
 *                                 type: boolean
 *                               isMuted:
 *                                 type: boolean
 *                               unreadCount:
 *                                 type: integer
 *                               lastMessageAt:
 *                                 type: string
 *                                 format: date-time
 *   post:
 *     summary: Create a new chat
 *     description: Create a new direct or group chat
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participantIds
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [direct, group]
 *               title:
 *                 type: string
 *               participantIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Chat created successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Chat already exists (for direct chats)
 */

const createChatSchema = z.object({
  type: z.enum(['direct', 'group']).optional(),
  title: z.string().optional(),
  participantIds: z.array(z.string().uuid()).min(1)
});

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
    // Get all chats where user is a participant with participant details
    const userChats = await db
      .select({
        id: chats.id,
        title: chats.title,
        type: chats.type,
        lastMessageAt: chats.last_message_at,
        createdAt: chats.created_at,
        isPinned: chat_participants.is_pinned,
        isMuted: chat_participants.is_muted,
        unreadCount: chat_participants.unread_count
      })
      .from(chats)
      .innerJoin(chat_participants, eq(chats.id, chat_participants.chat_id))
      .where(
        and(
          eq(chat_participants.user_id, user.user_id),
          eq(chats.org_id, user.org_id)
        )
      )
      .orderBy(desc(chats.last_message_at), desc(chats.created_at));

    // For each chat, get participant details
    const chatsWithParticipants = await Promise.all(
      userChats.map(async (chat) => {
        const participants = await db
          .select({
            id: users.id,
            email: users.email,
            full_name: users.full_name,
            avatar_url: users.avatar_url
          })
          .from(chat_participants)
          .innerJoin(users, eq(chat_participants.user_id, users.id))
          .where(eq(chat_participants.chat_id, chat.id));

        return {
          ...chat,
          participants
        };
      })
    );

    return createApiResponse({ chats: chatsWithParticipants });
  } catch (error) {
    console.error('Error fetching chats:', error);
    return createErrorResponse('Failed to fetch chats', 500, ApiErrorCode.DATABASE_ERROR);
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
    const validatedData = createChatSchema.parse(body);
    const { type, title, participantIds } = validatedData;

    // Include current user in participants
    const allParticipants = Array.from(new Set([user.user_id, ...participantIds]));
    const chatType = type || (allParticipants.length > 2 ? 'group' : 'direct');

    // For direct chats, check if chat already exists
    if (chatType === 'direct' && allParticipants.length === 2) {
      const existingChat = await db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chat_participants, eq(chats.id, chat_participants.chat_id))
        .where(
          and(
            eq(chats.type, 'direct'),
            eq(chats.org_id, user.org_id),
            inArray(chat_participants.user_id, allParticipants)
          )
        )
        .groupBy(chats.id)
        .having(sql`COUNT(DISTINCT ${chat_participants.user_id}) = 2`)
        .limit(1);

      if (existingChat.length > 0) {
        return createApiResponse({ 
          chat: { id: existingChat[0].id }, 
          existing: true 
        });
      }
    }

    // Validate all participants exist in the same organization
    const validParticipants = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, allParticipants),
          eq(users.org_id, user.org_id)
        )
      );

    if (validParticipants.length !== allParticipants.length) {
      return createErrorResponse('One or more participants not found', 400, ApiErrorCode.INVALID_INPUT);
    }

    // Create chat in transaction
    const result = await db.transaction(async (tx) => {
      // Create chat
      const [newChat] = await tx
        .insert(chats)
        .values({
          org_id: user.org_id,
          type: chatType,
          title: chatType === 'group' ? title : undefined,
          created_by: user.user_id
        })
        .returning();

      // Add participants
      const participantValues = allParticipants.map(participantId => ({
        chat_id: newChat.id,
        user_id: participantId
      }));

      await tx.insert(chat_participants).values(participantValues);

      return newChat;
    });

    return createApiResponse({ chat: result }, true, []);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid input data', 400, ApiErrorCode.INVALID_INPUT);
    }
    return createErrorResponse('Failed to create chat', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
