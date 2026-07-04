import { buildEnv } from '../helpers/make-controller';
import { createMockPrisma } from '../helpers/mock-prisma';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../../src/rhino.config';
import { QueryBuilderService } from '../../src/services/query-builder.service';
import { ScopeService } from '../../src/services/scope.service';
import { ResourceScopeService } from '../../src/services/resource-scope.service';
import type { RhinoScope, RhinoNamedScope, ScopeContext } from '../../src/services/scope.service';

class RoutePolicy extends ResourcePolicy {}
class TagPolicy extends ResourcePolicy {}

/**
 * Global scope (user-aware owner filter). When a user is present it narrows to
 * their own rows; with no user it fails CLOSED (empty set). Proves `ctx.user`
 * reaches the scope.
 */
class OwnRoutesScope implements RhinoScope {
  apply(where: Record<string, any>, ctx: ScopeContext): Record<string, any> {
    if (!ctx.user) return { ...where, id: { in: [] } };
    return { ...where, ownerId: ctx.user.id };
  }
}

/** Named scope: only active rows (AND-ed into the where as a fragment). */
class ActiveScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return { status: 'active' };
  }
}

const namedScopes = { active: ActiveScope };

const baseCfg = {
  models: {
    routes: {
      model: 'route',
      policy: RoutePolicy,
      belongsToOrganization: true,
      scopes: [OwnRoutesScope],
      namedScopes,
      paginationEnabled: true,
      allowedFilters: ['title'],
      allowedSorts: ['title'],
    },
    // A NON-org model: no org context required.
    tags: {
      model: 'tag',
      policy: TagPolicy,
      belongsToOrganization: false,
    },
  },
};

// Org-only variant (no global owner scope) — isolates org-filter assertions
// from the user-aware scope, which fails closed when no ctx.user is present.
const orgOnlyCfg = {
  models: {
    routes: { ...baseCfg.models.routes, scopes: [] as any[] },
    tags: baseCfg.models.tags,
  },
};

const orgA = { id: 1, slug: 'orgA' };
const orgB = { id: 2, slug: 'orgB' };

function userCtx(userId: number, org: any) {
  return {
    user: { id: userId, email: `${userId}@b.c`, userRoles: [{ organizationId: org.id, permissions: ['routes.*'] }] },
    organization: org,
  };
}

/**
 * Seed two orgs. In org A: user 1 owns ids 1 (active) + 3 (inactive); user 2
 * owns id 2 (active). Org B rows must never leak.
 */
function seed() {
  return {
    route: [
      { id: 1, title: 'A-one', status: 'active', ownerId: 1, organizationId: 1 },
      { id: 2, title: 'A-two', status: 'active', ownerId: 2, organizationId: 1 },
      { id: 3, title: 'A-three', status: 'inactive', ownerId: 1, organizationId: 1 },
      { id: 10, title: 'B-one', status: 'active', ownerId: 1, organizationId: 2 },
      { id: 11, title: 'B-two', status: 'active', ownerId: 2, organizationId: 2 },
    ],
    tag: [
      { id: 1, name: 'red' },
      { id: 2, name: 'blue' },
    ],
  };
}

/** Build a ResourceScopeService over the same mock prisma/config as buildEnv. */
function buildScope(cfg: any, data: Record<string, any[]>) {
  const client = createMockPrisma(data);
  const prisma = new PrismaService(client);
  const config = new RhinoConfigService(normalizeConfig(cfg));
  const queryBuilder = new QueryBuilderService();
  const scopes = new ScopeService();
  const service = new ResourceScopeService(prisma, config, queryBuilder, scopes);
  return { client, prisma, config, service };
}

describe('ResourceScopeService (resource-scope resolver)', () => {
  it('1. scopedWhere injects organizationId; count/findMany return only org-A rows, never org-B', async () => {
    const { service } = buildScope(orgOnlyCfg, seed());
    const where = service.scopedWhere('routes', { organization: orgA });
    expect(where).toMatchObject({ organizationId: orgA.id });

    const rows = await service.findMany('routes', { organization: orgA });
    expect(rows.every((r: any) => r.organizationId === orgA.id)).toBe(true);
    expect(rows.some((r: any) => r.organizationId === orgB.id)).toBe(false);

    const total = await service.count('routes', { organization: orgA });
    expect(total).toBe(3); // ids 1,2,3 — org A only (not the 5 table rows)
  });

  it('2. two orgs yield disjoint sets; test FAILS if the org filter were dropped', async () => {
    const { service } = buildScope(orgOnlyCfg, seed());
    const aRows = await service.findMany('routes', { organization: orgA });
    const bRows = await service.findMany('routes', { organization: orgB });

    const aIds = aRows.map((r: any) => r.id).sort();
    const bIds = bRows.map((r: any) => r.id).sort();
    expect(aIds).toEqual([1, 2, 3]);
    expect(bIds).toEqual([10, 11]);
    // Disjoint — no id appears in both sets.
    expect(aIds.filter((id: number) => bIds.includes(id))).toEqual([]);
    // If the org filter were dropped, org A would have seen all 5 rows.
    expect(aRows.length).toBe(3);
  });

  it('3. fail closed: scopedWhere with no organization on a belongsToOrganization model throws 403 TENANT_CONTEXT_REQUIRED', () => {
    const { service } = buildScope(baseCfg, seed());
    let thrown: any;
    try {
      service.scopedWhere('routes', { user: { id: 1 } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    const body = thrown.getResponse() as any;
    expect(body.code).toBe('TENANT_CONTEXT_REQUIRED');
    expect(body.message).toBe("Rhino resource scope for 'routes' requires an organization context");
  });

  it('4. non-org model: scopedWhere returns without requiring org (no throw)', () => {
    const { service } = buildScope(baseCfg, seed());
    expect(() => service.scopedWhere('tags', {})).not.toThrow();
    const where = service.scopedWhere('tags', {});
    expect(where.organizationId).toBeUndefined();
  });

  it('5. global scopes applied: userA vs userB (same org) differ — ctx.user reaches the scope', async () => {
    const { service } = buildScope(baseCfg, seed());
    const asUser1 = await service.findMany('routes', userCtx(1, orgA));
    const asUser2 = await service.findMany('routes', userCtx(2, orgA));

    // user1 owns ids 1 & 3 in org A; user2 owns id 2.
    expect(asUser1.map((r: any) => r.id).sort()).toEqual([1, 3]);
    expect(asUser2.map((r: any) => r.id)).toEqual([2]);
    // Never cross-org, even with the owner scope.
    expect(asUser1.some((r: any) => r.organizationId === orgB.id)).toBe(false);
  });

  it('6a. named scope: ANDs the fragment with orgFilter + scopes', async () => {
    const { service } = buildScope(baseCfg, seed());
    const rows = await service.findMany('routes', userCtx(1, orgA), {}, { namedScope: 'active' });
    // user1 + org A + active -> only id 1 (id 3 is inactive, id 2 is user2's).
    expect(rows.map((r: any) => r.id)).toEqual([1]);
  });

  it('6b. named scope: unknown / non-whitelisted key throws 403', () => {
    const { service } = buildScope(baseCfg, seed());
    let thrown: any;
    try {
      service.scopedWhere('routes', { organization: orgA }, { namedScope: 'secret' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'secret' is not allowed");
  });

  it('6c. named scope: prototype key (constructor) throws 403, not a 500/TypeError', () => {
    const { service } = buildScope(baseCfg, seed());
    let thrown: any;
    try {
      service.scopedWhere('routes', { organization: orgA }, { namedScope: 'constructor' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'constructor' is not allowed");
  });

  it('7a. count injects the scoped where (scoped total, not table total)', async () => {
    const { service } = buildScope(baseCfg, seed());
    // org A + user1 owner scope -> ids 1,3 => 2.
    const total = await service.count('routes', userCtx(1, orgA));
    expect(total).toBe(2);
    // Sanity: table has 5 rows overall; scoped count is not that.
    expect(total).not.toBe(5);
  });

  it('7b. aggregate injects the scoped where (scoped sum, not table sum)', async () => {
    const data = {
      route: [
        { id: 1, title: 'a', status: 'active', ownerId: 1, organizationId: 1, cost: 10 },
        { id: 2, title: 'b', status: 'active', ownerId: 2, organizationId: 1, cost: 20 },
        { id: 3, title: 'c', status: 'active', ownerId: 1, organizationId: 2, cost: 100 },
      ],
    };
    const { service } = buildScope(orgOnlyCfg, data);
    const agg = await service.aggregate('routes', { organization: orgA }, { _sum: { cost: true } });
    // org A rows: 10 + 20 = 30 (org B's 100 excluded).
    expect(agg._sum.cost).toBe(30);
  });

  it('7c. groupBy injects the scoped where (only scoped rows are grouped)', async () => {
    const data = {
      route: [
        { id: 1, title: 'a', status: 'active', ownerId: 1, organizationId: 1 },
        { id: 2, title: 'b', status: 'inactive', ownerId: 2, organizationId: 1 },
        { id: 3, title: 'c', status: 'active', ownerId: 1, organizationId: 2 },
      ],
    };
    const { service } = buildScope(orgOnlyCfg, data);
    const groups: any[] = await service.groupBy(
      'routes',
      { organization: orgA },
      { by: ['status'], _count: { _all: true } },
    );
    const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    // org A only: one active, one inactive; org B's active row excluded.
    expect(byStatus).toEqual({ active: 1, inactive: 1 });
  });

  it('8. composition: caller-provided extra where is AND-ed with the scoped where (both apply)', async () => {
    const { service } = buildScope(baseCfg, seed());
    // Extra where restricts to a title; scoped where restricts to org A + user1.
    const rows = await service.findMany(
      'routes',
      userCtx(1, orgA),
      { where: { title: 'A-one' } },
    );
    expect(rows.map((r: any) => r.id)).toEqual([1]);

    // A caller-supplied where can never break OUT of the org scope: asking for a
    // known org-B id from org A yields nothing.
    const leak = await service.findMany('routes', { organization: orgA }, { where: { id: 10 } });
    expect(leak).toEqual([]);
  });

  it('9. parity: scopedWhere yields the same isolation as CRUD findAll for the same ctx', async () => {
    const data = seed();
    // CRUD path via the full env.
    const env = buildEnv(baseCfg as any, data);
    const crud: any = await env.controllers.global.index('routes', {}, userCtx(1, orgA) as any);
    const crudIds = crud.items.map((r: any) => r.id).sort();

    // Resolver path over an identical, independent dataset.
    const { service } = buildScope(baseCfg, seed());
    const resolved = await service.findMany('routes', userCtx(1, orgA));
    const resolvedIds = resolved.map((r: any) => r.id).sort();

    expect(resolvedIds).toEqual(crudIds);
  });

  it('extra: fail-closed when ScopeService is absent but a named scope is requested', () => {
    const client = createMockPrisma(seed());
    const prisma = new PrismaService(client);
    const config = new RhinoConfigService(normalizeConfig(baseCfg as any));
    const queryBuilder = new QueryBuilderService();
    const service = new ResourceScopeService(prisma, config, queryBuilder); // no ScopeService

    let thrown: any;
    try {
      service.scopedWhere('routes', { organization: orgA }, { namedScope: 'active' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'active' is not allowed");
  });

  it('extra: unknown model slug throws', () => {
    const { service } = buildScope(baseCfg, seed());
    expect(() => service.scopedWhere('ghost', { organization: orgA })).toThrow(/Unknown model: ghost/);
  });
});
