# BAP Backend - Business Asset Platform

## Overview

A Next.js-based backend for the Business Asset Platform (BAP), a multi-tenant SaaS application designed for enterprise use. Built with PostgreSQL, featuring Row Level Security (RLS) for tenant isolation, multi-region readiness, and scalable architecture supporting multiple organizations on a single database pool.


## Quick Start

### Prerequisites

- **Node.js**: v18.17.0 or higher
- **PostgreSQL**: v14 or higher
- **npm**: v9.0.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/Deivanai03/bap-backend.git
cd bap-backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your database credentials
```

### Database Setup

```bash
# 1. Install PostgreSQL and Create database and user
sudo -u postgres psql
CREATE DATABASE bap_db;
CREATE USER bap_user WITH PASSWORD '<password>';
GRANT ALL PRIVILEGES ON DATABASE bap_db TO bap_user;
\q

# 2. Generate and run migrations
npm run db:generate
npm run db:migrate

# 3. Setup Row Level Security (RLS) and constraints
npm run db:setup-rls
```

### Development

```bash
# Start development server
npm run dev

# Server will run on http://localhost:3001
```


## Database Schema

### Core Tables
- `organizations` - Tenant entities with billing/regional config
- `users` - User accounts with roles and preferences  
- `user_sessions` - Active sessions with device tracking
- `audit_events` - Comprehensive security audit log


## Authentication Module

The authentication system is fully implemented with enterprise-grade security:

#### Features Implemented
- **Magic Link Authentication** - Email-based, passwordless login. 5 requests per hour per email
- **Multi-Tenant Isolation** - RLS ensures data separation
- **Session Management** - JWT + HTTP-only cookies
- **Device Tracking** - Browser, OS, IP tracking
- **Rate Limiting** - 300 requests per minute per IP
- **Audit Logging** - All auth events logged
- **Input Validation** - Strong Zod schemas
- **Email Immutability** - Database-level constraint


## API Routes

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/auth/register` | Register new organization + user | No |
| `POST` | `/api/auth/send-magic-link` | Send magic link to email | No |
| `POST` | `/api/auth/verify-magic-link` | Verify magic link & create session | No |
| `GET` | `/api/auth/me` | Get current user profile | Yes |

### Request/Response Examples

#### Register Organization
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "email": "john@example.com", 
    "organization_name": "Acme Corp",
    "home_region": "IN",
    "billing_country": "IN",
    "currency": "INR"
  }'
```

#### Send Magic Link
```bash
curl -X POST http://localhost:3001/api/auth/send-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com"}'
```

#### Verify Magic Link
```bash
curl -X POST http://localhost:3001/api/auth/verify-magic-link \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN_FROM_EMAIL"}'
```

#### Get User Profile
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-11T12:40:49.788Z"
  }
}
```
