import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';
import { normalizeConfig } from '../../src/rhino.config';
import { ResourceService } from '../../src/services/resource.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RhinoConfigService } from '../../src/rhino.config';
import { QueryBuilderService } from '../../src/services/query-builder.service';
import { createMockPrisma } from '../helpers/mock-prisma';
import type { RhinoNamedScope, ScopeContext } from '../../src/services/scope.service';

class RoutePolicy extends ResourcePolicy {}

// A scalar scope — needs only the top-level AND extension in the mock.
class ActiveScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return { status: 'active' };
  }
}

// A context-aware scope — fails closed (empty result) with no user.
class AvailableForDriversScope implements RhinoNamedScope {
  apply(ctx: ScopeContext): Record<string, any> {
    if (!ctx.user) return { id: { in: [] } };
    return { status: 'active', ownerId: ctx.user.id };
  }
}

function ctxUser(userId = 1, orgId = 1, perms = ['routes.*']) {
  return {
    user: { id: userId, email: `${userId}@b.c`, userRoles: [{ organizationId: orgId, permissions: perms }] },
    organization: { id: orgId, slug: `org${orgId}` },
  };
}

const namedScopes = { active: ActiveScope, availableForDrivers: AvailableForDriversScope };

const baseCfg = {
  models: {
    routes: {
      model: 'route',
      policy: RoutePolicy,
      belongsToOrganization: true,
      namedScopes,
      defaultScope: 'active',
      paginationEnabled: true,
      perPage: 2,
      allowedFilters: ['title'],
      allowedSorts: ['title'],
    },
  },
};

/** Seed: org1 rows — mix of active/inactive, owned by user1/user2. */
function seed() {
  return {
    route: [
      { id: 1, title: 'Keep', status: 'active', ownerId: 1, organizationId: 1 },
      { id: 2, title: 'Alpha', status: 'active', ownerId: 2, organizationId: 1 },
      { id: 3, title: 'Draft', status: 'inactive', ownerId: 1, organizationId: 1 },
      { id: 4, title: 'Beta', status: 'active', ownerId: 1, organizationId: 1 },
      // other org — must never leak
      { id: 5, title: 'Other', status: 'active', ownerId: 1, organizationId: 2 },
    ],
  };
}

describe('Named scopes (?scope=) integration', () => {
  it('1. applies the default scope when no ?scope is sent (only active rows)', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index('routes', {}, ctxUser() as any);
    // active org-1 rows: ids 1,2,4 -> total 3 (page size 2)
    expect(res.total).toBe(3);
    expect(res.items.every((r: any) => r.status === 'active')).toBe(true);
    expect(res.items.some((r: any) => r.id === 3)).toBe(false);
  });

  it('2. availableForDrivers as user 1 returns only user1 active rows', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'availableForDrivers' },
      ctxUser(1) as any,
    );
    expect(res.total).toBe(2); // ids 1 and 4
    expect(res.items.map((r: any) => r.id).sort()).toEqual([1, 4]);
  });

  it('3. the default scope is still requestable by name', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index('routes', { scope: 'active' }, ctxUser() as any);
    expect(res.total).toBe(3);
    expect(res.items.every((r: any) => r.status === 'active')).toBe(true);
  });

  it('4. unknown scope throws RhinoException 403', async () => {
    const env = buildEnv(baseCfg, seed());
    let thrown: any;
    try {
      await env.controllers.global.index('routes', { scope: 'secret' }, ctxUser() as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'secret' is not allowed");
  });

  it('5. prototype key (constructor) throws 403 — not a 500/TypeError', async () => {
    const env = buildEnv(baseCfg, seed());
    let thrown: any;
    try {
      await env.controllers.global.index('routes', { scope: 'constructor' }, ctxUser() as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'constructor' is not allowed");
  });

  it('6. array/repeated ?scope throws 403 Scope is not allowed', async () => {
    const env = buildEnv(baseCfg, seed());
    let thrown: any;
    try {
      await env.controllers.global.index('routes', { scope: ['active', 'availableForDrivers'] }, ctxUser() as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe('Scope is not allowed');
  });

  it('7. composes with a filter', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'active', filter: { title: 'Keep' } },
      ctxUser() as any,
    );
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe(1);
  });

  it('8. composes with a sort', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'active', sort: 'title' },
      ctxUser() as any,
    );
    // active org-1 titles ascending: Alpha, Beta, Keep — page 1 (perPage 2)
    expect(res.items.map((r: any) => r.title)).toEqual(['Alpha', 'Beta']);
  });

  it('9. pagination total reflects the SCOPED count, not the table count', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index('routes', { scope: 'active' }, ctxUser() as any);
    expect(res.total).toBe(3); // 3 active org-1 rows (not 4 org-1 rows, not 5 table rows)
    expect(res.perPage).toBe(2);
    expect(res.lastPage).toBe(2);
  });

  it('10. org isolation: user in org1 never sees org2 rows even with availableForDrivers', async () => {
    const env = buildEnv(baseCfg, {
      route: [
        { id: 1, title: 'Mine', status: 'active', ownerId: 1, organizationId: 1 },
        { id: 2, title: 'Theirs', status: 'active', ownerId: 1, organizationId: 2 },
      ],
    });
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'availableForDrivers' },
      ctxUser(1, 1) as any,
    );
    expect(res.items.map((r: any) => r.id)).toEqual([1]);
    expect(res.items.some((r: any) => r.organizationId === 2)).toBe(false);
  });

  it('11. current user is injected: user1 vs user2 yield different sets', async () => {
    const env1 = buildEnv(baseCfg, seed());
    const res1: any = await env1.controllers.global.index('routes', { scope: 'availableForDrivers' }, ctxUser(1) as any);
    expect(res1.items.map((r: any) => r.id).sort()).toEqual([1, 4]);

    const env2 = buildEnv(baseCfg, seed());
    const res2: any = await env2.controllers.global.index('routes', { scope: 'availableForDrivers' }, ctxUser(2) as any);
    expect(res2.items.map((r: any) => r.id)).toEqual([2]);
  });

  it('12. fail-closed: no user yields an empty set', async () => {
    const env = buildEnv(baseCfg, seed());
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'availableForDrivers' },
      { organization: { id: 1, slug: 'org1' } } as any,
    );
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
  });

  it('13. trashed honors the scope (only deleted + active)', async () => {
    const env = buildEnv(
      {
        models: {
          routes: { ...baseCfg.models.routes, softDeletes: true },
        },
      },
      {
        route: [
          { id: 1, title: 'DelActive', status: 'active', ownerId: 1, organizationId: 1, deletedAt: new Date() },
          { id: 2, title: 'DelInactive', status: 'inactive', ownerId: 1, organizationId: 1, deletedAt: new Date() },
          { id: 3, title: 'LiveActive', status: 'active', ownerId: 1, organizationId: 1, deletedAt: null },
        ],
      },
    );
    const res: any = await env.controllers.global.trashed('routes', { scope: 'active' }, ctxUser() as any);
    expect(res.items.map((r: any) => r.id)).toEqual([1]);
  });

  it('14. show is NOT scoped: a record hidden by the default scope is still returned', async () => {
    const env = buildEnv(baseCfg, seed());
    // id 3 is inactive → hidden from index by the default scope
    const idx: any = await env.controllers.global.index('routes', {}, ctxUser() as any);
    expect(idx.items.some((r: any) => r.id === 3)).toBe(false);

    // show returns it regardless, and a bogus ?scope on show does not 403
    const rec: any = await env.controllers.global.show('routes', '3', { scope: 'bogus' }, ctxUser() as any);
    expect(rec).toMatchObject({ id: 3, status: 'inactive' });
  });

  it('15. fail-closed when ScopeService is absent: findAll throws 403 rather than returning unscoped', async () => {
    const client = createMockPrisma(seed());
    const prisma = new PrismaService(client);
    const config = new RhinoConfigService(normalizeConfig(baseCfg as any));
    const queryBuilder = new QueryBuilderService();
    // No ScopeService wired in (@Optional()).
    const resources = new ResourceService(prisma, config, queryBuilder);

    let thrown: any;
    try {
      await resources.findAll('routes', { scope: 'active' }, { user: { id: 1 }, organization: { id: 1 } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as any).message).toBe("Scope 'active' is not allowed");
  });

  it('17. composes with a search (AND-wraps the search OR; both must hold)', async () => {
    // Config variant that exposes `title` to search so ?search builds an OR.
    const searchCfg = {
      models: {
        routes: { ...baseCfg.models.routes, allowedSearch: ['title'] },
      },
    };
    const env = buildEnv(searchCfg, {
      route: [
        // matches search 'match' AND scope (active) AND org1 -> survives
        { id: 1, title: 'match-me', status: 'active', ownerId: 1, organizationId: 1 },
        // matches search but excluded by the scope (inactive) -> absent
        { id: 2, title: 'match-too', status: 'inactive', ownerId: 1, organizationId: 1 },
        // matches the scope (active) but NOT the search -> absent
        { id: 3, title: 'other', status: 'active', ownerId: 1, organizationId: 1 },
        // matches search + scope but WRONG org -> absent
        { id: 4, title: 'match-elsewhere', status: 'active', ownerId: 1, organizationId: 2 },
      ],
    });
    const res: any = await env.controllers.global.index(
      'routes',
      { scope: 'active', search: 'match' },
      ctxUser() as any,
    );
    // Only the row satisfying BOTH the search-OR AND the scope+org survives.
    expect(res.total).toBe(1);
    expect(res.items.map((r: any) => r.id)).toEqual([1]);
    // search-match-but-wrong-scope, scope-match-but-no-search, wrong-org: all gone
    expect(res.items.some((r: any) => r.id === 2)).toBe(false);
    expect(res.items.some((r: any) => r.id === 3)).toBe(false);
    expect(res.items.some((r: any) => r.id === 4)).toBe(false);
  });

  it('18. namedScopes without a defaultScope stay unscoped: index({}) returns ALL org rows', async () => {
    const { defaultScope, ...routesNoDefault } = baseCfg.models.routes;
    const noDefaultCfg = { models: { routes: routesNoDefault } };
    // Page 1 total proves the count is unscoped (all 4 org-1 rows, incl. inactive).
    const env = buildEnv(noDefaultCfg, seed());
    const p1: any = await env.controllers.global.index('routes', {}, ctxUser() as any);
    expect(p1.total).toBe(4);
    const p2: any = await env.controllers.global.index('routes', { page: 2 }, ctxUser() as any);
    const allIds = [...p1.items, ...p2.items].map((r: any) => r.id).sort();
    expect(allIds).toEqual([1, 2, 3, 4]);
    expect(allIds).toContain(3); // inactive row survives — no scope was applied
    // org-2 row (id 5) still never leaks — org filter is orthogonal to scoping
    expect([...p1.items, ...p2.items].some((r: any) => r.organizationId === 2)).toBe(false);
  });

  it('16. boot validation: defaultScope not in namedScopes throws at normalizeConfig', () => {
    expect(() =>
      normalizeConfig({
        models: {
          routes: {
            model: 'route',
            namedScopes: { active: ActiveScope },
            defaultScope: 'ghost',
          },
        },
      } as any),
    ).toThrow(/defaultScope 'ghost' is not a declared key/);
  });
});
