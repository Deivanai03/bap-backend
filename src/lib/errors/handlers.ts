import { ApiErrorCode, createErrorResponse } from '../api/response';

export function handleDatabaseError(error: any) {
  console.error('Database error:', error);
  
  // PostgreSQL specific error codes
  if (error.code) {
    switch (error.code) {
      case '23505': // Unique violation
        return createErrorResponse(
          'Resource already exists',
          409,
          ApiErrorCode.INVALID_INPUT
        );
      case '23503': // Foreign key violation
        return createErrorResponse(
          'Referenced resource not found',
          400,
          ApiErrorCode.INVALID_INPUT
        );
      case '23514': // Check constraint violation
        return createErrorResponse(
          'Invalid data provided',
          400,
          ApiErrorCode.INVALID_INPUT
        );
      case 'ETIMEDOUT':
      case 'ECONNREFUSED':
        return createErrorResponse(
          'Database connection failed',
          503,
          ApiErrorCode.DATABASE_ERROR
        );
    }
  }
  
  // Drizzle ORM errors
  if (error.message?.includes('Failed query')) {
    return createErrorResponse(
      'Database query failed',
      500,
      ApiErrorCode.DATABASE_ERROR
    );
  }
  
  // Generic database error
  return createErrorResponse(
    'Internal server error',
    500,
    ApiErrorCode.INTERNAL_ERROR
  );
}

export function handleStripeError(error: any) {
  console.error('Stripe error:', error);
  
  if (error.type === 'StripeCardError') {
    return createErrorResponse(
      error.message || 'Payment failed',
      402,
      ApiErrorCode.PAYMENT_FAILED
    );
  }
  
  if (error.type === 'StripeInvalidRequestError') {
    return createErrorResponse(
      'Invalid payment request',
      400,
      ApiErrorCode.STRIPE_ERROR
    );
  }
  
  return createErrorResponse(
    'Payment service error',
    503,
    ApiErrorCode.EXTERNAL_SERVICE_ERROR
  );
}
