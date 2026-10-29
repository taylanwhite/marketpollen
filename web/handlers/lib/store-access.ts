import { prisma } from './db.js';
import { isOrgAdmin } from './org-access.js';
import { isPlatformAdmin } from './king-admin.js';
import { STORE_ARCHIVED_MESSAGE, STORE_PAUSED_MESSAGE } from './billing-copy.js';
import { billingAccess } from './org-billing-access.js';

type JsonResponse = { status: (code: number) => { json: (body: unknown) => unknown } };

/**
 * A paused store can still be opened and read. Writes wait until it is turned back on.
 * If the pause date has passed, lock it here even when the renewal webhook has not arrived.
 */
export async function rejectIfStoreLocked(res: JsonResponse, storeId: string, uid?: string | null): Promise<boolean> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      billing_status: true,
      is_demo: true,
      pause_on: true,
      archived_at: true,
      organization: {
        select: {
          billing_enabled: true,
          subscription_status: true,
          trial_ends_at: true,
          payment_failed_at: true,
        },
      },
    },
  });
  if (!store) return false;
  // Demo stores are free, so an unpaid organization doesn't lock them.
  if (store.organization && !store.is_demo) {
    const access = billingAccess(store.organization);
    if (access.mode === 'trial_ended' || access.mode === 'payment_locked') {
      if (!(uid && await isPlatformAdmin(uid))) {
        res.status(403).json({
          error: access.mode === 'trial_ended'
            ? 'Trial is done, please pay.'
            : 'Insufficient payment. Update the card to continue.',
        });
        return true;
      }
    }
  }
  if (store.archived_at) {
    res.status(403).json({ error: STORE_ARCHIVED_MESSAGE });
    return true;
  }
  const due = store.billing_status === 'pause_scheduled' && !!store.pause_on && store.pause_on.getTime() <= Date.now();
  if (due) {
    await prisma.store.update({ where: { id: storeId }, data: { billing_status: 'paused' } });
  }
  if (store.billing_status === 'paused' || due) {
    res.status(403).json({ error: STORE_PAUSED_MESSAGE });
    return true;
  }
  return false;
}

/**
 * Check if user can mutate store data. Global admin or an explicit store permission.
 * Org admin without a store invite can view, not write.
 */
export async function canAccessStore(uid: string, storeId: string): Promise<boolean> {
  if (await isPlatformAdmin(uid)) return true;
  const perm = await prisma.storePermission.findUnique({
    where: { user_id_store_id: { user_id: uid, store_id: storeId } },
  });
  return !!perm;
}

/**
 * Check if user can read store data. Includes org admins for stores in their org.
 */
export async function canViewStore(uid: string, storeId: string): Promise<boolean> {
  if (await canAccessStore(uid, storeId)) return true;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { organization_id: true },
  });
  if (!store?.organization_id) return false;
  return isOrgAdmin(uid, store.organization_id);
}

export type AccessibleStores = { all: true } | { ids: string[] };

export async function getAccessibleStores(uid: string): Promise<AccessibleStores> {
  if (await isPlatformAdmin(uid)) return { all: true };

  const [perms, adminOrgs] = await Promise.all([
    prisma.storePermission.findMany({
      where: { user_id: uid },
      select: { store_id: true },
    }),
    prisma.organizationMember.findMany({
      where: { user_id: uid, is_admin: true },
      select: { org_id: true },
    }),
  ]);

  const ids = new Set(perms.map((p) => p.store_id));
  if (adminOrgs.length > 0) {
    const orgStores = await prisma.store.findMany({
      where: { organization_id: { in: adminOrgs.map((o) => o.org_id) } },
      select: { id: true },
    });
    for (const store of orgStores) ids.add(store.id);
  }
  return { ids: [...ids] };
}

function queryFlag(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1' || raw === 'true';
}

/**
 * Resolve which stores a GET list may return.
 * `storeId` = one store. `orgId` = that org. `allStores` = every store the user can view.
 * Returns null when the request is missing a scope or not allowed.
 * Returns undefined store filter (unrestricted) only for global admins asking for all stores.
 */
export async function readableStoreScope(
  uid: string,
  query: { storeId?: string; orgId?: string; allStores?: unknown },
): Promise<{ unrestricted: true } | { storeIds: string[] } | null> {
  const storeId = query.storeId?.trim();
  const orgId = query.orgId?.trim();
  const allStores = queryFlag(query.allStores);

  if (!storeId && !orgId && !allStores) return null;

  const access = await getAccessibleStores(uid);

  if (storeId) {
    if ('all' in access || access.ids.includes(storeId)) return { storeIds: [storeId] };
    if (await canViewStore(uid, storeId)) return { storeIds: [storeId] };
    return null;
  }

  if (orgId) {
    if (!('all' in access) && !(await isOrgAdmin(uid, orgId))) return null;
    const orgStores = await prisma.store.findMany({
      where: { organization_id: orgId },
      select: { id: true, is_demo: true },
    });
    const visible = orgStores.filter((store) => 'all' in access || access.ids.includes(store.id));
    return { storeIds: withoutDemoStores(visible) };
  }

  if ('all' in access) {
    // Platform-wide totals leave demo stores out too.
    const demoCount = await prisma.store.count({ where: { is_demo: true } });
    if (demoCount === 0) return { unrestricted: true };
    const real = await prisma.store.findMany({ where: { is_demo: false }, select: { id: true } });
    return { storeIds: real.map((store) => store.id) };
  }
  const mine = await prisma.store.findMany({ where: { id: { in: access.ids } }, select: { id: true, is_demo: true } });
  return { storeIds: withoutDemoStores(mine) };
}

/**
 * Multi-store views (reports, bites, the org map) leave demo stores out so
 * practice data doesn't inflate real numbers. When every store is a demo
 * (a demo organization), keep them all so the demo still has numbers.
 */
function withoutDemoStores(stores: Array<{ id: string; is_demo: boolean }>): string[] {
  const real = stores.filter((store) => !store.is_demo);
  return (real.length > 0 ? real : stores).map((store) => store.id);
}

export function storeIdWhere(
  scope: { unrestricted: true } | { storeIds: string[] },
): { store_id?: string | { in: string[] } } {
  if ('unrestricted' in scope) return {};
  return { store_id: { in: scope.storeIds } };
}
