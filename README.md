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
     "organization_name": "Your Company"
   }
   ```
3. Continue with magic link steps below

**For Existing Users:**
1. Navigate to http://localhost:3001/api/docs
2. Use `POST /api/auth/send-magic-link` with your email
3. Check email for magic link and extract token
4. Use `POST /api/auth/verify-magic-link` with token
5. Copy JWT from response
6. Click "Authorize" in Swagger UI and enter: `Bearer YOUR_JWT_TOKEN`

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
- Magic Link Authentication - Email-based, passwordless login with rate limiting (5 requests per hour per email)
- Multi-Tenant Isolation - RLS ensures complete data separation between organizations
- Session Management - JWT tokens with HTTP-only cookies and device tracking
- Device Tracking - Browser, OS, IP address, and location tracking
- Rate Limiting - 300 requests per minute per IP address
- Audit Logging - All authentication events logged with GDPR/HIPAA compliance flags
- Input Validation - Comprehensive Zod schemas for all inputs
- Email Immutability - Database-level constraint prevents email changes

### Security Features
- Row Level Security (RLS) enabled on all tables
- Parameterized queries via Drizzle ORM prevent SQL injection
- JWT token validation with session verification
- Comprehensive error handling with structured error codes
- Request/response logging for security monitoring


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
- `POST /api/auth/register` - Register new organization and user
- `POST /api/auth/send-magic-link` - Send magic link to email address
- `POST /api/auth/verify-magic-link` - Verify magic link and create session
- `POST /api/auth/refresh` - Refresh JWT token using refresh token
- `GET /api/auth/me` - Get current user profile and permissions

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
- `DELETE /api/payment-methods/:id` - Remove payment method

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
