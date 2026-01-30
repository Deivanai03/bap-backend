import { NextRequest } from 'next/server';
import { verifyAuthAndGetUser } from '../../../../middleware/auth';
import { revokeSession } from '../../../../lib/auth/session';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';

export async function OPTIONS() {
  return handleOptions();
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  try {
    await revokeSession(null, params.id);
    return createApiResponse({ message: 'Session revoked successfully' });
  } catch (error: any) {
    console.error('Error revoking session:', error);
    return createErrorResponse('Failed to revoke session', 500, ApiErrorCode.DATABASE_ERROR);
  }
}
