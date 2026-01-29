import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { db } from '../../../../lib/db';
import { messages, chats, chat_participants, users } from '../../../../lib/db/schema';
import { eq, and, ilike, desc, count, inArray } from 'drizzle-orm';

/**
 * @swagger
 * /api/messages/search:
 *   get:
 *     summary: Search messages across all chats
 *     description: Search for messages across all chats the user has access to
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: chatId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Limit search to specific chat
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
 *         description: Messages found successfully
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
 *                         messages:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               content:
 *                                 type: string
 *                               messageType:
 *                                 type: string
 *                               createdAt:
 *                                 type: string
 *                                 format: date-time
 *                               sender:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   fullName:
 *                                     type: string
 *                                   email:
 *                                     type: string
 *                                   avatarUrl:
 *                                     type: string
 *                               chat:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   title:
 *                                     type: string
 *                                   type:
 *                                     type: string
 *                               highlights:
 *                                 type: array
 *                                 items:
 *                                   type: string
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
 *       400:
 *         description: Search query is required
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
    const query = searchParams.get('q');
    const chatId = searchParams.get('chatId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    if (!query) {
      return createErrorResponse('Search query is required', 400, ApiErrorCode.INVALID_INPUT);
    }

    // Get user's accessible chat IDs
    const userChats = await db
      .select({ chatId: chat_participants.chat_id })
      .from(chat_participants)
      .innerJoin(chats, eq(chat_participants.chat_id, chats.id))
      .where(
        and(
          eq(chat_participants.user_id, user.id),
          eq(chats.org_id, user.org_id)
        )
      );

    const chatIds = userChats.map(row => row.chatId);

    if (chatIds.length === 0) {
      return createApiResponse({
        messages: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      });
    }

    // Build search conditions
    let whereConditions = [
      inArray(messages.chat_id, chatIds),
      ilike(messages.content, `%${query}%`)
    ];

    if (chatId) {
      whereConditions.push(eq(messages.chat_id, chatId));
    }

    // Search messages
    const searchResults = await db
      .select({
        id: messages.id,
        content: messages.content,
        messageType: messages.message_type,
        metadata: messages.metadata,
        createdAt: messages.created_at,
        sender: {
          id: users.id,
          fullName: users.full_name,
          email: users.email,
          avatarUrl: users.avatar_url
        },
        chat: {
          id: chats.id,
          title: chats.title,
          type: chats.type
        }
      })
      .from(messages)
      .innerJoin(users, eq(messages.sender_id, users.id))
      .innerJoin(chats, eq(messages.chat_id, chats.id))
      .where(and(...whereConditions))
      .orderBy(desc(messages.created_at))
      .limit(limit)
      .offset((page - 1) * limit);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(messages)
      .where(and(...whereConditions));

    const total = totalResult.count;

    // Add highlights for matched terms
    const messagesWithHighlights = searchResults.map(message => ({
      ...message,
      highlights: [query], // Simple highlighting - could be enhanced
    }));

    return createApiResponse({
      messages: messagesWithHighlights,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return createErrorResponse('Failed to search messages', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
