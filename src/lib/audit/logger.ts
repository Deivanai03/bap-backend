import { db } from '../db';
import { audit_events } from '../db/schema';
import { NextRequest } from 'next/server';

interface AuditEventData {
  org_id?: string;
  user_id?: string;
  event_type: string;
  event_category: 'auth' | 'org' | 'billing' | 'security' | 'compliance' | 'data';
  actor_type: 'user' | 'system' | 'admin' | 'api';
  actor_id?: string;
  resource_type?: string;
  resource_id?: string;
  action: string;
  description?: string;
  changes?: any;
  metadata?: any;
  request?: NextRequest;
}

export async function logAuditEvent(data: AuditEventData): Promise<void> {
  try {
    const ip_address = data.request?.headers.get('x-forwarded-for') || 
                      data.request?.headers.get('x-real-ip') || 
                      data.request?.ip;
    
    const user_agent = data.request?.headers.get('user-agent');
    
    await db.insert(audit_events).values({
      org_id: data.org_id,
      user_id: data.user_id,
      event_type: data.event_type,
      event_category: data.event_category,
      actor_type: data.actor_type,
      actor_id: data.actor_id,
      resource_type: data.resource_type,
      resource_id: data.resource_id,
      action: data.action,
      description: data.description,
      changes: data.changes,
      metadata: data.metadata,
      ip_address: ip_address,
      user_agent: user_agent,
      request_id: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}
