import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { db } from '../../../lib/db';
import { users } from '../../../lib/db/schema';
import { eq, and, or, ilike, count } from 'drizzle-orm';

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get users with search and filter
 *     description: Retrieve users from the same organization with optional search and filtering
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, invited, suspended, deleted]
 *         description: Filter by user status
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
 *         description: Users retrieved successfully
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
 *                         users:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               fullName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               avatarUrl:
 *                                 type: string
 *                               onlineStatus:
 *                                 type: string
 *                                 enum: [online, offline, away, busy]
 *                               lastSeen:
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
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Build where conditions
    let whereConditions = [eq(users.org_id, user.org_id)];
    
    if (search) {
      whereConditions.push(
        or(
          ilike(users.full_name, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )!
      );
    }
    
    if (status) {
      whereConditions.push(eq(users.status, status as any));
    }

    // Get users
    const usersList = await db
      .select({
        id: users.id,
        fullName: users.full_name,
        email: users.email,
        avatarUrl: users.avatar_url,
        onlineStatus: users.online_status,
        lastSeen: users.last_seen,
        status: users.status,
        role: users.role
      })
      .from(users)
      .where(and(...whereConditions))
      .orderBy(users.full_name)
      .limit(limit)
      .offset((page - 1) * limit);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(users)
      .where(and(...whereConditions));

    const total = totalResult.count;

    return createApiResponse({
      users: usersList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return createErrorResponse('Failed to fetch users', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
