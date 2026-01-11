import { SignJWT, jwtVerify } from 'jose';
import { AuthJWTPayload } from '../../types';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function signToken(payload: AuthJWTPayload, expiresIn = '7d'): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as AuthJWTPayload;
  } catch {
    return null;
  }
}