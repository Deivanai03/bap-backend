import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// Helper to set tenant context for RLS
export async function setTenantContext(orgId: string) {
  await db.execute(`SET LOCAL app.org_id = '${orgId}'`);
}
