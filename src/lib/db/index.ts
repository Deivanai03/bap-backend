import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection could not be established
  query_timeout: 10000, // Query timeout of 10 seconds
});

export const db = drizzle(pool, { schema });

// Helper to set tenant context for RLS
export async function setTenantContext(orgId: string) {
  try {
    // SET LOCAL doesn't support parameterized queries, so we need to use string interpolation
    // But we validate the UUID format first for security
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
      throw new Error('Invalid organization ID format');
    }
    await db.execute(sql.raw(`SET LOCAL app.org_id = '${orgId}'`));
  } catch (error) {
    console.error('Failed to set tenant context:', error);
    throw new Error('Database connection failed');
  }
}
