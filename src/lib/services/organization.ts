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
  
  return await db.transaction(async (tx) => {
    // Create organization
    const orgResult = await tx.insert(organizations).values({
      name: data.name,
      slug: `${slug}-${uuidv4().slice(0, 8)}`,
      billing_email: data.billing_email,
      home_region: data.home_region,
      billing_country: data.billing_country,
      currency: data.currency,
      plan_tier: 'FREE',
      status: 'active',
    }).returning();

    // Create owner user
    const ownerResult = await tx.insert(users).values({
      org_id: orgResult[0].id,
      email: data.owner_email,
      full_name: data.owner_name,
      role: 'OWNER',
      status: 'active',
      email_verified: false,
    }).returning();

    return { organization: orgResult[0], owner: ownerResult[0] };
  });
}

export async function getOrganization(orgId: string) {
  const result = await db.select().from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  
  return result[0] || null;
}