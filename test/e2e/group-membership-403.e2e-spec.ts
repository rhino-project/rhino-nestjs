import { ResolveOrganizationMiddleware } from '../../src/middleware/resolve-organization.middleware';
import { OrganizationService } from '../../src/services/organization.service';
import { GroupMembershipGuard } from '../../src/guards/group-membership.guard';
import { MembershipService } from '../../src/services/membership.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../../src/rhino.config';
import { RhinoException } from '../../src/errors/rhino-exception';
import { NotFoundException } from '@nestjs/common';
import type { RhinoConfig } from '../../src/interfaces/rhino-config.interface';

/**
 * Request-flow harness for design §11.2: membership denial must be 403, not
 * 404, when `auth.enforceGroupMembership` is ON. This chains the REAL
 * ResolveOrganizationMiddleware (org-resolution 404) and the REAL
 * GroupMembershipGuard (membership 403) in their wired order and asserts that
 * the 403 takes precedence — while OFF (default) keeps today's 404 exactly.
 */
describe('§11.2 membership denial precedence (403 vs 404)', () => {
  function makePrisma(orgs: any[], memberships: any[]) {
    return new PrismaService({
      organization: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            orgs.find((o) => Object.entries(where).every(([k, v]) => o[k] === v)) ?? null,
          ),
        ),
      },
      userRole: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            memberships.find(
              (m) => m.userId === where.userId && m.organizationId === where.organizationId,
            ) ?? null,
          ),
        ),
      },
    } as any);
  }

  function buildFlow(cfg: RhinoConfig, prisma: PrismaService) {
    const config = new RhinoConfigService(normalizeConfig(cfg));
    const orgService = new OrganizationService(prisma, config);
    const orgMw = new ResolveOrganizationMiddleware(orgService);
    const membership = new MembershipService(config);
    const guard = new GroupMembershipGuard(config, membership);
    return { orgMw, guard };
  }

  // Drive a request through org-resolution middleware then the membership guard,
  // surfacing whichever HTTP status fires first.
  async function runRequest(
    cfg: RhinoConfig,
    prisma: PrismaService,
    req: any,
  ): Promise<{ status?: number; allowed?: boolean }> {
    const { orgMw, guard } = buildFlow(cfg, prisma);
    try {
      // `use` is async: it may reject (thrown error) OR call next(err). Cover
      // both — mirrors how Nest's pipeline surfaces a middleware failure.
      await new Promise<void>((resolve, reject) => {
        Promise.resolve(orgMw.use(req, {} as any, (err?: any) => (err ? reject(err) : resolve()))).catch(
          reject,
        );
      });
    } catch (e: any) {
      return { status: e?.getStatus?.() ?? (e instanceof NotFoundException ? 404 : undefined) };
    }
    try {
      const allowed = guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as any);
      return { allowed: Boolean(allowed) };
    } catch (e: any) {
      return { status: e?.getStatus?.() };
    }
  }

  const tenantCfg: RhinoConfig = {
    models: { posts: { model: 'post' } },
    multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
    routeGroups: { tenant: { prefix: ':organization', tenant: true, models: '*' } },
    auth: { enforceGroupMembership: true },
  } as RhinoConfig;

  it('enforcement ON: authenticated non-member → 403 (not 404)', async () => {
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], []); // user is not a member
    const req: any = {
      params: { organization: 'acme' },
      __routeGroup: 'tenant',
      user: { id: 42, userRoles: [] }, // no membership row at all
    };
    const result = await runRequest(tenantCfg, prisma, req);
    expect(result.status).toBe(403);
  });

  it('enforcement ON: member of the group + org → allowed (200-equivalent)', async () => {
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], [{ userId: 42, organizationId: 1 }]);
    const req: any = {
      params: { organization: 'acme' },
      __routeGroup: 'tenant',
      user: {
        id: 42,
        userRoles: [{ routeGroup: 'tenant', organizationId: 1, permissions: ['posts.*'] }],
      },
    };
    const result = await runRequest(tenantCfg, prisma, req);
    expect(result.allowed).toBe(true);
    expect(req.organization).toEqual({ id: 1, slug: 'acme' });
  });

  it('enforcement ON: member of the org but WRONG group → 403', async () => {
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], [{ userId: 42, organizationId: 1 }]);
    const req: any = {
      params: { organization: 'acme' },
      __routeGroup: 'tenant',
      user: {
        id: 42,
        // org matches, but the membership is scoped to a different group
        userRoles: [{ routeGroup: 'admin', organizationId: 1, permissions: [] }],
      },
    };
    const result = await runRequest(tenantCfg, prisma, req);
    expect(result.status).toBe(403);
  });

  it('enforcement ON: genuinely non-existent org → 404 (still)', async () => {
    const prisma = makePrisma([], []); // org does not exist
    const req: any = {
      params: { organization: 'ghost' },
      __routeGroup: 'tenant',
      user: { id: 42, userRoles: [] },
    };
    const result = await runRequest(tenantCfg, prisma, req);
    expect(result.status).toBe(404);
  });

  it('enforcement OFF (default): non-member → 404 (byte-for-byte unchanged)', async () => {
    const offCfg: RhinoConfig = {
      ...tenantCfg,
      auth: { enforceGroupMembership: false },
    } as RhinoConfig;
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], []); // not a member
    const req: any = {
      params: { organization: 'acme' },
      __routeGroup: 'tenant',
      user: { id: 42, userRoles: [] },
    };
    const result = await runRequest(offCfg, prisma, req);
    // Old info-hiding behavior: org-resolution 404 fires first, guard is a no-op.
    expect(result.status).toBe(404);
  });

  it('enforcement OFF (default): the guard is a pure no-op (regression guard)', async () => {
    const offCfg: RhinoConfig = {
      ...tenantCfg,
      auth: { enforceGroupMembership: false },
    } as RhinoConfig;
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], [{ userId: 42, organizationId: 1 }]);
    const config = new RhinoConfigService(normalizeConfig(offCfg));
    const guard = new GroupMembershipGuard(config, new MembershipService(config));
    // Even a user scoped to a different group passes when enforcement is off.
    const req: any = {
      __routeGroup: 'tenant',
      user: { id: 42, userRoles: [{ routeGroup: 'admin', organizationId: 1 }] },
    };
    expect(
      guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any),
    ).toBe(true);
    // permission source untouched (no __membershipPermissions injected)
    expect((req.user as any).__membershipPermissions).toBeUndefined();
  });

  it('throws a RhinoException with MEMBERSHIP_DENIED code on the 403', async () => {
    const prisma = makePrisma([{ id: 1, slug: 'acme' }], []);
    const { orgMw, guard } = buildFlow(tenantCfg, prisma);
    const req: any = {
      params: { organization: 'acme' },
      __routeGroup: 'tenant',
      user: { id: 42, userRoles: [] },
    };
    await new Promise<void>((resolve, reject) =>
      orgMw.use(req, {} as any, (err?: any) => (err ? reject(err) : resolve())),
    );
    try {
      guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
      fail('expected 403');
    } catch (e) {
      expect(e).toBeInstanceOf(RhinoException);
      expect((e as RhinoException).code).toBe('MEMBERSHIP_DENIED');
      expect((e as RhinoException).getStatus()).toBe(403);
    }
  });
});
