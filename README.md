# BAP Backend - Business Asset Platform

## Overview

A Next.js-based backend for the Business Asset Platform (BAP), a multi-tenant SaaS application designed for enterprise use. Built with PostgreSQL, featuring Row Level Security (RLS) for tenant isolation, multi-region readiness, and scalable architecture supporting multiple organizations on a single database pool.

## Quick Start

### Prerequisites

- Node.js v18.17.0 or higher
- PostgreSQL v14 or higher
- npm v9.0.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/Deivanai03/bap-backend.git
cd bap-backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### Database Setup

```bash
# For shared cloud database
# Note: Database is already seeded with test data - no setup required

# For local development setup (optional)
npm run db:generate
npm run db:migrate
psql "postgresql://bap_user:<password>@localhost:5432/bap_db" -f src/lib/db/setup-rls.sql
npm run seed
```

### Development

```bash
# Start development server
npm run dev

# Server will run on http://localhost:3001
```

## Testing & Development

### API Documentation
- **Swagger UI**: http://localhost:3001/api/docs
- **Interactive Testing**: Use Swagger UI with built-in authentication

### Authentication Setup

**For New Users:**
1. Navigate to http://localhost:3001/api/docs
2. Use `POST /api/auth/register` to create account:
   ```json
   {
     "email": "your-email@example.com",
     "full_name": "Your Name",
     "organization_name": "Your Company",
     "home_region": "IN",
     "billing_country": "IN",
     "currency": "INR"
   }
   ```
3. Check email for magic link and click it
4. Complete onboarding process
5. Use returned JWT token for API access

**For Existing Users:**
1. Navigate to http://localhost:3001/api/docs
2. Use `POST /api/auth/send-magic-link` with your email
3. Check email for magic link and click it
4. Use `POST /api/auth/verify-magic-link` with the token from the magic link url.
5. Use returned JWT token for API access

**Alternative OTP Flow:**
1. Get magic link from email
2. Use `GET /api/auth/get-otp?token=TOKEN` to extract OTP
3. Use `POST /api/auth/verify-otp` with email, OTP, and token
4. Use returned JWT token for API access

### Database Access
- **Drizzle Studio**: `npm run db:studio` (opens at http://localhost:4983)
- **Direct Access**: Use DATABASE_URL from .env file

## Architecture

### Database Schema

#### Core Tables
- `organizations` - Tenant entities with billing and regional configuration
- `users` - User accounts with roles and preferences  
- `user_sessions` - Active sessions with device tracking
- `audit_events` - Comprehensive security audit log

#### Billing Tables
- `plans` - Subscription plans with features and limits
- `subscriptions` - Organization subscriptions
- `payment_methods` - Stored payment methods
- `invoices` - Billing invoices with PDF storage
- `usage_tracking` - Feature usage metrics

### Multi-Tenancy

- Pool Model: Single PostgreSQL cluster with shared schema
- Tenant Isolation: Row Level Security (RLS) with org_id filtering
- Session Context: `SET LOCAL app.org_id` for automatic data isolation
- Scalability: Supports 10,000+ tenants before requiring sharding

## Authentication Module

The authentication system is fully implemented with enterprise-grade security:

### Features Implemented
- **Magic Link Authentication** - Email-based, passwordless login with secure token verification
- **Email Verification Required** - Users created only after email verification (no unverified accounts in database)
- **Multi-Tenant Isolation** - RLS ensures complete data separation between organizations
- **Global Email Uniqueness** - Database-level constraint prevents duplicate emails across organizations
- **Session Management** - JWT tokens with HTTP-only cookies and comprehensive device tracking
- **Device Tracking** - Browser, OS, IP address, device ID, and location tracking for security
- **Rate Limiting** - 300 requests per minute per IP address
- **Audit Logging** - All authentication events logged with GDPR/HIPAA compliance flags
- **Input Validation** - Comprehensive Zod schemas for all inputs
- **CORS Support** - Standardized CORS headers across all API endpoints

### Security Features
- Row Level Security (RLS) enabled on all tables
- Parameterized queries via Drizzle ORM prevent SQL injection
- JWT token validation with session verification
- Comprehensive error handling with structured error codes
- Request/response logging for security monitoring
- Device fingerprinting for fraud detection

### Authentication Flow
- **Registration**: User submits registration data → Magic link sent to email → Email verification → User/org creation + JWT session token returned
- **Login**: Existing users request magic link → Magic link sent to email → Email verification → JWT session token returned  
- **Verification**: Single endpoint handles both registration and login magic link tokens


## Billing Module

The billing system integrates with Stripe for payment processing:

### Features Implemented
- Stripe Integration - Complete payment processing with webhooks
- Multi-Currency Support - USD, EUR, INR with automatic tax calculation
- Plan Management - FREE, PRO, BUSINESS, ENTERPRISE tiers with feature flags
- Usage Tracking - Infrastructure for usage metrics and limit checking
- Invoice Management - PDF generation and storage
- Payment Methods - Secure storage and management of payment cards
- Subscription Management - Upgrades, downgrades, and cancellations
- Role-Based Access - Plan visibility based on organization tier

### Plan-Based Features
- Individual Plans (FREE/PRO): Full billing access and payment management
- Business/Enterprise Plans: Usage limits only, billing managed by organization owner

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new organization and user (sends magic link to email)
- `POST /api/auth/send-magic-link` - Send magic link to existing users only
- `POST /api/auth/verify-magic-link` - Verify magic link and create session (handles both registration and login)
- `POST /api/auth/get-otp` - Extract OTP from magic link token (supports both JWT and database tokens)
- `POST /api/auth/verify-otp` - Verify OTP and create session (supports both registration and login flows)
- `POST /api/auth/refresh` - Refresh JWT token using refresh token
- `POST /api/auth/logout` - Logout and revoke session
- `GET /api/auth/me` - Get current user profile and permissions (includes onboarding status)

### Onboarding
- `POST /api/auth/onboarding/complete` - Complete onboarding process with organization and user data

### Plans & Subscriptions
- `GET /api/plans` - List available subscription plans
- `GET /api/subscriptions/current` - Get current subscription (plan-based visibility)
- `POST /api/subscriptions/upgrade` - Upgrade subscription (OWNER role required)
- `POST /api/subscriptions/cancel` - Cancel subscription

### Billing
- `GET /api/invoices` - List organization invoices
- `GET /api/invoices/:id/download` - Download invoice PDF
- `GET /api/payment-methods` - List payment methods
- `POST /api/payment-methods` - Add new payment method
- `DELETE /api/payment-methods/:id` - Remove payment method (accepts both database UUID and Stripe payment method ID)

### Usage & Limits
- `GET /api/usage/current` - Get current period usage metrics

### Webhooks
- `POST /api/webhooks/stripe` - Stripe webhook endpoint for real-time updates

## Authentication

All endpoints (except authentication and public endpoints) require JWT Bearer token:

```
Authorization: Bearer <jwt_token>
```

## Response Format

All API responses follow this standardized structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-13T10:30:00Z"
  },
  "errors": []
}
```

Error responses include structured error codes:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "Access denied"
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-13T10:30:00Z"
  },
  "errors": ["Access denied"]
}
```

## Role-Based Access Control

### User Roles
- **OWNER**: Full access including billing, organization management, and user deletion
- **ADMIN**: User management and settings (no billing access)
- **MEMBER**: Standard user access with usage visibility
- **GUEST**: Read-only access with limited features

### Implemented Permissions
- **Billing operations**: OWNER only (subscription upgrade)
- **Usage metrics**: All authenticated users
- **Plan-based visibility**: Individual vs Business/Enterprise plan access

### Permission Infrastructure
- RBAC middleware available for future endpoint implementation
- Role hierarchy and permission matrix defined
- Ready for user management and audit log endpoints
