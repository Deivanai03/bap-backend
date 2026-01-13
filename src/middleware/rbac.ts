import { AuthenticatedRequest } from './auth';
import { createErrorResponse } from '../lib/api/response';

export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';

export interface RolePermissions {
  // Billing permissions
  manage_billing: boolean;
  view_billing: boolean;
  
  // User management
  invite_users: boolean;
  manage_users: boolean;
  delete_users: boolean;
  
  // Organization management
  manage_org_settings: boolean;
  delete_organization: boolean;
  
  // Subscription management
  upgrade_subscription: boolean;
  cancel_subscription: boolean;
  
  // General access
  view_usage: boolean;
  view_audit_logs: boolean;
}

const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  OWNER: {
    manage_billing: true,
    view_billing: true,
    invite_users: true,
    manage_users: true,
    delete_users: true,
    manage_org_settings: true,
    delete_organization: true,
    upgrade_subscription: true,
    cancel_subscription: true,
    view_usage: true,
    view_audit_logs: true,
  },
  ADMIN: {
    manage_billing: false, // No billing access per MD requirements
    view_billing: false,
    invite_users: true,
    manage_users: true,
    delete_users: true,
    manage_org_settings: true,
    delete_organization: false,
    upgrade_subscription: false,
    cancel_subscription: false,
    view_usage: true,
    view_audit_logs: true,
  },
  MEMBER: {
    manage_billing: false,
    view_billing: false,
    invite_users: false,
    manage_users: false,
    delete_users: false,
    manage_org_settings: false,
    delete_organization: false,
    upgrade_subscription: false,
    cancel_subscription: false,
    view_usage: true,
    view_audit_logs: false,
  },
  GUEST: {
    manage_billing: false,
    view_billing: false,
    invite_users: false,
    manage_users: false,
    delete_users: false,
    manage_org_settings: false,
    delete_organization: false,
    upgrade_subscription: false,
    cancel_subscription: false,
    view_usage: true,
    view_audit_logs: false,
  },
};

export function requirePermission(permission: keyof RolePermissions) {
  return (request: AuthenticatedRequest) => {
    const userRole = request.user.role as UserRole;
    const permissions = ROLE_PERMISSIONS[userRole];
    
    if (!permissions[permission]) {
      throw new Error(`Insufficient permissions. Required: ${permission}`);
    }
  };
}

export function requireRole(allowedRoles: UserRole[]) {
  return (request: AuthenticatedRequest) => {
    const userRole = request.user.role as UserRole;
    
    if (!allowedRoles.includes(userRole)) {
      throw new Error(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
    }
  };
}

export function hasPermission(role: UserRole, permission: keyof RolePermissions): boolean {
  return ROLE_PERMISSIONS[role][permission];
}
