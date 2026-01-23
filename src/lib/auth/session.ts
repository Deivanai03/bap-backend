import { db, setTenantContext } from '../db';
import { user_sessions, users, organizations } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { signToken } from './jwt';
import { SessionData, CreateSessionResult, ActiveSession, SessionError } from '../../types';

const SESSION_EXPIRY_DAYS = 7;
const SALT_ROUNDS = 12;

export async function createSession(sessionData: SessionData): Promise<CreateSessionResult> {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const hashedRefreshToken = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await setTenantContext(sessionData.org_id);

  return await db.transaction(async (tx) => {
    // Create session record
    const [session] = await tx.insert(user_sessions).values({
      user_id: sessionData.user_id,
      org_id: sessionData.org_id,
      session_token: sessionToken,
      refresh_token: hashedRefreshToken,
      device_id: sessionData.device_id,
      device_type: sessionData.device_type,
      device_name: sessionData.device_name,
      os: sessionData.os,
      browser: sessionData.browser,
      ip_address: sessionData.ip_address,
      user_agent: sessionData.user_agent,
      location: sessionData.location,
      expires_at: expiresAt,
    }).returning();

    // Update user last login
    await tx.update(users)
      .set({
        last_login_at: new Date(),
        last_active_at: new Date(),
        login_count: sql`${users.login_count} + 1`,
      })
      .where(eq(users.id, sessionData.user_id));

    // Get user data for response
    const [user] = await tx.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      role: users.role,
      org_id: users.org_id,
    }).from(users).where(eq(users.id, sessionData.user_id));

    // Get organization plan_tier
    const [org] = await tx.select({
      plan_tier: organizations.plan_tier,
    }).from(organizations).where(eq(organizations.id, user.org_id));

    // Create JWT token for API requests (24 hours)
    const jwtToken = await signToken({
      userId: user.id,
      orgId: user.org_id,
      email: user.email,
      role: user.role,
      sessionToken: sessionToken,
    }, '24h');

    return {
      session_token: sessionToken,
      refresh_token: refreshToken,
      jwt_token: jwtToken,
      expires_at: expiresAt,
      user: {
        ...user,
        organization: {
          plan_tier: org.plan_tier
        }
      },
    };
  });
}

export async function validateSession(sessionToken: string): Promise<SessionData | null> {
  if (!sessionToken?.trim()) {
    return null;
  }

  const [session] = await db.select({
    id: user_sessions.id,
    user_id: user_sessions.user_id,
    org_id: user_sessions.org_id,
    expires_at: user_sessions.expires_at,
    is_active: user_sessions.is_active,
    user_email: users.email,
    user_role: users.role,
    user_status: users.status,
  })
  .from(user_sessions)
  .innerJoin(users, eq(user_sessions.user_id, users.id))
  .where(and(
    eq(user_sessions.session_token, sessionToken.trim()),
    eq(user_sessions.is_active, true)
  ))
  .limit(1);

  if (!session) {
    return null;
  }

  // Check if session expired
  if (session.expires_at < new Date()) {
    await revokeSession(sessionToken);
    return null;
  }

  // Check if user is active
  if (session.user_status !== 'active') {
    await revokeSession(sessionToken);
    return null;
  }

  // Update last activity
  await db.update(user_sessions)
    .set({ last_activity_at: new Date() })
    .where(eq(user_sessions.id, session.id));

  return {
    user_id: session.user_id,
    org_id: session.org_id,
    email: session.user_email,
    role: session.user_role,
  };
}

export async function refreshSession(refreshToken: string): Promise<CreateSessionResult | null> {
  if (!refreshToken?.trim()) {
    return null;
  }

  // Get all active sessions with refresh tokens
  const sessions = await db.select({
    id: user_sessions.id,
    user_id: user_sessions.user_id,
    org_id: user_sessions.org_id,
    expires_at: user_sessions.expires_at,
    refresh_token: user_sessions.refresh_token,
  })
  .from(user_sessions)
  .where(and(
    eq(user_sessions.is_active, true),
    sql`${user_sessions.refresh_token} IS NOT NULL`
  ));

  // Find session by comparing hashed refresh tokens
  let session = null;
  for (const s of sessions) {
    if (s.refresh_token && await bcrypt.compare(refreshToken.trim(), s.refresh_token)) {
      session = s;
      break;
    }
  }

  if (!session) {
    throw new SessionError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  // Check if refresh token expired (30 days)
  const refreshExpiry = new Date(session.expires_at.getTime() + 23 * 24 * 60 * 60 * 1000);
  if (refreshExpiry < new Date()) {
    await revokeSession(null, session.id);
    throw new SessionError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  // Revoke old session
  await revokeSession(null, session.id);

  // Get user data
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    org_id: users.org_id,
    status: users.status,
  }).from(users).where(eq(users.id, session.user_id));

  if (!user || user.status !== 'active') {
    throw new SessionError('User not found or inactive', 'USER_INACTIVE');
  }

  // Create new session
  return createSession({
    user_id: user.id,
    org_id: user.org_id,
    email: user.email,
    role: user.role,
  });
}

export async function revokeSession(sessionToken?: string | null, sessionId?: string): Promise<void> {
  if (sessionToken) {
    await db.update(user_sessions)
      .set({
        is_active: false,
        revoked_at: new Date(),
      })
      .where(eq(user_sessions.session_token, sessionToken));
  } else if (sessionId) {
    await db.update(user_sessions)
      .set({
        is_active: false,
        revoked_at: new Date(),
      })
      .where(eq(user_sessions.id, sessionId));
  }
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(user_sessions)
    .set({
      is_active: false,
      revoked_at: new Date(),
    })
    .where(and(
      eq(user_sessions.user_id, userId),
      eq(user_sessions.is_active, true)
    ));
}

export async function getUserActiveSessions(userId: string): Promise<ActiveSession[]> {
  await setTenantContext((await db.select({ org_id: users.org_id }).from(users).where(eq(users.id, userId)))[0].org_id);
  
  return db.select({
    id: user_sessions.id,
    device_type: user_sessions.device_type,
    device_name: user_sessions.device_name,
    os: user_sessions.os,
    browser: user_sessions.browser,
    ip_address: user_sessions.ip_address,
    location: user_sessions.location,
    created_at: user_sessions.created_at,
    last_activity_at: user_sessions.last_activity_at,
    expires_at: user_sessions.expires_at,
  })
  .from(user_sessions)
  .where(and(
    eq(user_sessions.user_id, userId),
    eq(user_sessions.is_active, true)
  ))
  .orderBy(sql`${user_sessions.last_activity_at} DESC`);
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.update(user_sessions)
    .set({
      is_active: false,
      revoked_at: new Date(),
    })
    .where(and(
      eq(user_sessions.is_active, true),
      sql`${user_sessions.expires_at} < NOW()`
    ));

  return result.rowCount || 0;
}
