import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export function createApiResponse<T>(
  data?: T,
  success = true,
  errors: string[] = []
): NextResponse {
  return NextResponse.json({
    success,
    data,
    meta: {
      request_id: `req_${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    },
    errors,
  });
}

export enum ApiErrorCode {
  // Authentication errors
  INVALID_SESSION = 'INVALID_SESSION',
  EXPIRED_TOKEN = 'EXPIRED_TOKEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Business logic errors
  FEATURE_UNAVAILABLE = 'FEATURE_UNAVAILABLE',
  USAGE_LIMIT_EXCEEDED = 'USAGE_LIMIT_EXCEEDED',
  PLAN_DOWNGRADE_NOT_ALLOWED = 'PLAN_DOWNGRADE_NOT_ALLOWED',
  
  // Payment errors
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND',
  STRIPE_ERROR = 'STRIPE_ERROR',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR'
}

export function createErrorResponse(
  error: string,
  status = 400,
  code?: ApiErrorCode
): NextResponse {
  return NextResponse.json({
    success: false,
    error: {
      code: code || 'UNKNOWN_ERROR',
      message: error
    },
    meta: {
      request_id: `req_${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    },
    errors: [error],
  }, { status });
}