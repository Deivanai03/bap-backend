import { NextRequest } from 'next/server';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: NextRequest) => string;
}

// In-memory store (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function createRateLimit(config: RateLimitConfig) {
  return async (request: NextRequest): Promise<{ success: boolean; remaining: number; resetTime: number }> => {
    const key = config.keyGenerator ? config.keyGenerator(request) : getDefaultKey(request);
    const now = Date.now();
    
    // Clean up expired entries
    const keysToDelete: string[] = [];
    rateLimitStore.forEach((value, k) => {
      if (value.resetTime < now) {
        keysToDelete.push(k);
      }
    });
    keysToDelete.forEach(k => rateLimitStore.delete(k));
    
    const current = rateLimitStore.get(key);
    
    if (!current || current.resetTime < now) {
      // New window
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + config.windowMs
      });
      return {
        success: true,
        remaining: config.maxRequests - 1,
        resetTime: now + config.windowMs
      };
    }
    
    if (current.count >= config.maxRequests) {
      return {
        success: false,
        remaining: 0,
        resetTime: current.resetTime
      };
    }
    
    current.count++;
    return {
      success: true,
      remaining: config.maxRequests - current.count,
      resetTime: current.resetTime
    };
  };
}

function getDefaultKey(request: NextRequest): string {
  const ip = request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             request.ip || 'unknown';
  return `rate_limit:${ip}`;
}

// Magic link rate limiter: 5 requests per hour per email (industry standard)
export const magicLinkRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5,
  keyGenerator: (request: NextRequest) => {
    // Rate limit by email, not IP (need to extract from body)
    const ip = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
    return `magic_link:${ip}`; // Will be improved to use email
  }
});

// General API rate limiter: More generous for multi-user scenarios
export const apiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 300 // 300 per minute per IP (allows ~5 users per IP)
});

// Strict rate limiter for sensitive endpoints
export const strictRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute  
  maxRequests: 10 // For admin/sensitive operations
});
