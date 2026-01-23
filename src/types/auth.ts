// Authentication Types
export interface SessionData {
  user_id: string;
  org_id: string;
  email: string;
  role: string;
  device_id?: string;
  device_type?: string;
  device_name?: string;
  os?: string;
  browser?: string;
  ip_address?: string;
  user_agent?: string;
  location?: any;
}

export interface CreateSessionResult {
  session_token: string;
  refresh_token: string;
  jwt_token: string;
  expires_at: Date;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    org_id: string;
    organization: {
      plan_tier: string;
    };
  };
}

export interface MagicLinkUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  org_id: string;
  email_verified: boolean;
}

export interface LoginContext {
  device_type?: string;
  device_name?: string;
  os?: string;
  browser?: string;
  ip_address?: string;
  user_agent?: string;
  location?: any;
}

export interface DeviceInfo {
  device_id?: string;
  device_type: string;
  device_name: string;
  os: string;
  browser: string;
  ip_address?: string;
  user_agent: string;
}

export interface ActiveSession {
  id: string;
  device_type: string | null;
  device_name: string | null;
  os: string | null;
  browser: string | null;
  ip_address: string | null;
  location: any;
  created_at: Date;
  last_activity_at: Date;
  expires_at: Date;
}

// JWT Payload
export interface AuthJWTPayload {
  userId: string;
  orgId: string;
  email: string;
  role: string;
  sessionToken: string;
  [key: string]: any;
}

// Error Types
export class AuthError extends Error {
  constructor(message: string, public code: string, public status: number = 401) {
    super(message);
    this.name = 'AuthError';
  }
}

export class SessionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export class MagicLinkError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'MagicLinkError';
  }
}
