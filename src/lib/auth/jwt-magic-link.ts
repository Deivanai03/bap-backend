import jwt from 'jsonwebtoken';
import { createSession } from './session';
import { createOrganization } from '../services/organization';
import { LoginContext, CreateSessionResult } from '../../types';
import { db } from '../db';
import { users } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET!;
const MAGIC_LINK_EXPIRY_MINUTES = 15;
const TOKEN_LENGTH = 32;
const SALT_ROUNDS = 12;

interface RegistrationTokenPayload {
  type: 'registration';
  email: string;
  full_name: string;
  organization_name: string;
  home_region: string;
  billing_country: string;
  currency: string;
  exp: number;
}

interface LoginTokenPayload {
  type: 'login';
  email: string;
  exp: number;
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateRegistrationToken(data: {
  email: string;
  full_name: string;
  organization_name: string;
  home_region: string;
  billing_country: string;
  currency: string;
}): string {
  const payload: RegistrationTokenPayload = {
    type: 'registration',
    email: data.email.toLowerCase().trim(),
    full_name: data.full_name,
    organization_name: data.organization_name,
    home_region: data.home_region,
    billing_country: data.billing_country,
    currency: data.currency,
    exp: Math.floor(Date.now() / 1000) + (MAGIC_LINK_EXPIRY_MINUTES * 60)
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

export async function generateLoginToken(email: string): Promise<string> {
  // Use existing logic from magic-link.ts
  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  const hashedToken = await bcrypt.hash(token, SALT_ROUNDS);
  const otp = generateOTP();
  const expires = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);
  
  const [user] = await db.select({
    id: users.id,
    org_id: users.org_id,
    status: users.status
  }).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  
  if (!user || user.status !== 'active') {
    throw new Error('User not found or inactive');
  }
  
  await db.update(users)
    .set({ 
      magic_link_token: hashedToken,
      magic_link_expires: expires,
      otp_code: otp,
      otp_expires: expires
    })
    .where(eq(users.id, user.id));
  
  return token;
}

export async function verifyTokenAndCreateSession(
  token: string,
  context: LoginContext = {}
): Promise<CreateSessionResult> {
  try {
    // First, try to decode as JWT (registration token)
    const decoded = jwt.verify(token, JWT_SECRET) as RegistrationTokenPayload | LoginTokenPayload;
    
    if (decoded.type === 'registration') {
      // Create new user and organization from JWT data
      const { organization, owner } = await createOrganization({
        name: decoded.organization_name,
        billing_email: decoded.email,
        home_region: decoded.home_region,
        billing_country: decoded.billing_country,
        currency: decoded.currency,
        owner_email: decoded.email,
        owner_name: decoded.full_name
      });
      
      // Create session for new user
      return await createSession({
        user_id: owner.id,
        org_id: organization.id,
        email: owner.email,
        role: owner.role,
        ...context
      });
    }
    
    // If it's a login JWT token, handle it differently
    throw new Error('Login JWT tokens not supported in this function');
    
  } catch (jwtError) {
    // Not a JWT or invalid JWT, try database lookup (old magic link system)
    const users_with_tokens = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      role: users.role,
      org_id: users.org_id,
      status: users.status,
      magic_link_token: users.magic_link_token,
      magic_link_expires: users.magic_link_expires,
    })
    .from(users)
    .where(sql`${users.magic_link_token} IS NOT NULL AND ${users.magic_link_expires} > NOW()`);
    
    // Find user by comparing hashed tokens
    let userData = null;
    for (const user of users_with_tokens) {
      if (user.magic_link_token && await bcrypt.compare(token.trim(), user.magic_link_token)) {
        userData = user;
        break;
      }
    }
    
    if (!userData) {
      throw new Error('Invalid or expired token');
    }
    
    // This is a login token - existing user
    if (userData.status !== 'active') {
      throw new Error('User account is not active');
    }
    
    // Clear magic link token and OTP, mark email as verified
    await db.update(users)
      .set({
        magic_link_token: null,
        magic_link_expires: null,
        otp_code: null,
        otp_expires: null,
        email_verified: true
      })
      .where(eq(users.id, userData.id));
    
    return await createSession({
      user_id: userData.id,
      org_id: userData.org_id,
      email: userData.email,
      role: userData.role,
      ...context
    });
  }
}
