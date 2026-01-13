import { NextRequest } from 'next/server';

// Email-specific rate limiter for magic links
const emailRateLimitStore = new Map<string, { count: number; resetTime: number }>();

export async function checkMagicLinkRateLimit(email: string): Promise<{ success: boolean; remaining: number; resetTime: number }> {
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 5; // 5 magic links per hour per email
  const now = Date.now();
  
  // Clean up expired entries
  const keysToDelete: string[] = [];
  emailRateLimitStore.forEach((value, k) => {
    if (value.resetTime < now) {
      keysToDelete.push(k);
    }
  });
  keysToDelete.forEach(k => emailRateLimitStore.delete(k));
  
  const key = `magic_link:${email.toLowerCase()}`;
  const current = emailRateLimitStore.get(key);
  
  if (!current || current.resetTime < now) {
    // New window
    emailRateLimitStore.set(key, {
      count: 1,
      resetTime: now + windowMs
    });
    return {
      success: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs
    };
  }
  
  if (current.count >= maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: current.resetTime
    };
  }
  
  current.count++;
  return {
    success: true,
    remaining: maxRequests - current.count,
    resetTime: current.resetTime
  };
}
