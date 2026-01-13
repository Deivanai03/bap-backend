import { db, setTenantContext } from '../db';
import { users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createSession } from './session';
import { LoginContext, CreateSessionResult, MagicLinkError } from '../../types';

const MAGIC_LINK_EXPIRY_MINUTES = 15;
const TOKEN_LENGTH = 32;
const SALT_ROUNDS = 12;

export async function generateMagicLink(email: string): Promise<string> {
  if (!email?.trim()) {
    throw new MagicLinkError('Email is required', 'INVALID_EMAIL');
  }

  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  const hashedToken = await bcrypt.hash(token, SALT_ROUNDS);
  const expires = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);
  
  const user = await db.select({
    id: users.id,
    org_id: users.org_id,
    status: users.status
  }).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  
  if (user.length === 0) {
    throw new MagicLinkError('User not found', 'USER_NOT_FOUND');
  }

  if (user[0].status !== 'active') {
    throw new MagicLinkError('User account is not active', 'USER_INACTIVE');
  }
  
  await setTenantContext(user[0].org_id);
  
  await db.update(users)
    .set({ 
      magic_link_token: hashedToken,
      magic_link_expires: expires
    })
    .where(eq(users.id, user[0].id));
  
  return token; // Return plain token for email
}

export async function verifyMagicLinkAndCreateSession(
  token: string, 
  context: LoginContext = {}
): Promise<CreateSessionResult> {
  if (!token?.trim()) {
    throw new MagicLinkError('Token is required', 'INVALID_TOKEN');
  }

  // Get all users with non-null magic_link_token and valid expiry
  const users_with_tokens = await db.select({
    id: users.id,
    email: users.email,
    full_name: users.full_name,
    role: users.role,
    org_id: users.org_id,
    email_verified: users.email_verified,
    magic_link_token: users.magic_link_token,
    magic_link_expires: users.magic_link_expires,
  })
  .from(users)
  .where(and(
    eq(users.status, 'active'),
    sql`${users.magic_link_token} IS NOT NULL`,
    sql`${users.magic_link_expires} > NOW()`
  ));
  
  // Find user by comparing hashed tokens
  let userData = null;
  for (const user of users_with_tokens) {
    if (user.magic_link_token && await bcrypt.compare(token.trim(), user.magic_link_token)) {
      userData = user;
      break;
    }
  }
  
  if (!userData) {
    throw new MagicLinkError('Invalid or expired token', 'INVALID_TOKEN');
  }
  
  await setTenantContext(userData.org_id);
  
  // Clear magic link token first
  await db.update(users)
    .set({
      magic_link_token: null,
      magic_link_expires: null,
      email_verified: true
    })
    .where(eq(users.id, userData.id));
  
  // Create session (already has its own transaction)
  const sessionResult = await createSession({
    user_id: userData.id,
    org_id: userData.org_id,
    email: userData.email,
    role: userData.role,
    ...context
  });

  return sessionResult;
}
