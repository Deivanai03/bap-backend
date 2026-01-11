import { NextRequest } from 'next/server';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function checkRateLimit(
  request: NextRequest,
  identifier: string,
  limit: number = 60
) {
  const key = `rate_limit:${identifier}`;
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, 60); // 1 minute window
  }
  
  const remaining = Math.max(0, limit - current);
  const resetTime = await redis.ttl(key);
  
  // Add rate limit headers
  const headers = {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': (Date.now() + resetTime * 1000).toString(),
  };
  
  if (current > limit) {
    throw new Error('Rate limit exceeded');
  }
  
  return headers;
}