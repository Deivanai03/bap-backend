import { db } from '../../lib/db';
import { organizations, users } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function createOrganization(data: {
  name: string;
  billing_email: string;
  home_region: string;
  billing_country: string;
  currency: string;
  owner_email: string;
  owner_name: string;
}) {
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  
  // Create organization
  const [org] = await db.insert(organizations).values({
    name: data.name,
    slug: `${slug}-${uuidv4().slice(0, 8)}`,
    billing_email: data.billing_email,
    home_region: data.home_region,
    billing_country: data.billing_country,
    currency: data.currency,
    plan_tier: 'INDIVIDUAL',
    is_trial: true,
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
    status: 'active',
  }).returning();

  // Create owner user
  const ownerResult = await db.insert(users).values({
    org_id: org.id,
    email: data.owner_email,
    full_name: data.owner_name,
    role: 'OWNER',
    status: 'active',
    email_verified: false,
  }).returning();

  const owner = Array.isArray(ownerResult) ? ownerResult[0] : ownerResult;

  return { organization: org, owner };
}

export async function getOrganization(orgId: string) {
  const [org] = await db.select().from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  
  return org;
}