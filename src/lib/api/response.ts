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

export function createErrorResponse(
  error: string,
  status = 400
): NextResponse {
  return NextResponse.json({
    success: false,
    meta: {
      request_id: `req_${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    },
    errors: [error],
  }, { status });
}