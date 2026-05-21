import {
  createTenantRouteRewrite,
  type TenantRouteRewriteOptions,
} from './tenant-route-rewrite';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

/**
 * Minimal Express req/res/next triple. `next` is tracked for call-through;
 * `res.statusCode` / `res.body` capture 404 short-circuits.
 */
function makeCtx(url: string, user?: any) {
  const req: any = { url, originalUrl: url };
  if (user) req.user = user;
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

function makePrisma(orgs: any[] = [], memberships: any[] = []) {
  return {
    organization: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(orgs.find((o) => Object.entries(where).every(([k, v]) => o[k] === v)) ?? null),
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
  };
}

function baseConfig(models: string[] = ['projects']): RhinoConfig {
  return {
    models: Object.fromEntries(models.map((s) => [s, { model: s }])),
    multiTenant: {
      enabled: true,
      organizationIdentifierColumn: 'slug',
      organizationModel: 'organization',
      userOrganizationModel: 'userRole',
    },
  };
}

describe('createTenantRouteRewrite (BP-001)', () => {
  // ------------------------------------------------------------------
  // Happy path
  // ------------------------------------------------------------------
  describe('happy path', () => {
    it('rewrites /api/<slug>/<rest> → /api/<rest> and attaches req.organization', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects');

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.organization).toEqual({ id: 1, slug: 'acme' });
      expect(req.url).toBe('/api/projects');
      expect(req.originalUrl).toBe('/api/projects');
    });

    it('preserves the query string after rewriting', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects?filter[status]=active&sort=-createdAt');

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.url).toBe('/api/projects?filter[status]=active&sort=-createdAt');
    });

    it('rewrites the index route /api/<slug>/<model> (no trailing path)', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects');
      await mw(req, res, next);
      expect(req.url).toBe('/api/projects');
      expect(next).toHaveBeenCalled();
    });

    it('rewrites /api/<slug>/<model>/<id> path', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects/42');
      await mw(req, res, next);
      expect(req.url).toBe('/api/projects/42');
    });
  });

  // ------------------------------------------------------------------
  // Reserved segments
  // ------------------------------------------------------------------
  describe('reserved segments pass through untouched', () => {
    it('does not touch /api/auth/login', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/auth/login');
      await mw(req, res, next);
      expect(req.url).toBe('/api/auth/login');
      expect(req.organization).toBeUndefined();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });

    it('does not touch /api/invitations/accept', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/invitations/accept');
      await mw(req, res, next);
      expect(req.url).toBe('/api/invitations/accept');
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });

    it('does not touch /api/nested', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/nested');
      await mw(req, res, next);
      expect(req.url).toBe('/api/nested');
    });

    it('custom reservedSegments option', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({
        prisma,
        config: baseConfig(),
        options: { reservedSegments: ['webhooks', 'health'] },
      });
      const { req, res, next } = makeCtx('/api/webhooks/stripe');
      await mw(req, res, next);
      expect(req.url).toBe('/api/webhooks/stripe');
      expect(req.organization).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Non-matching URL patterns
  // ------------------------------------------------------------------
  describe('passes through non-matching URLs', () => {
    it('leaves /health alone (no api prefix)', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/health');
      await mw(req, res, next);
      expect(req.url).toBe('/health');
      expect(next).toHaveBeenCalled();
    });

    it('leaves root / alone', async () => {
      const prisma = makePrisma();
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/');
      await mw(req, res, next);
      expect(req.url).toBe('/');
    });

    it('non-strict mode passes unknown slug through (model slug path)', async () => {
      const prisma = makePrisma(); // no orgs
      const mw = createTenantRouteRewrite({
        prisma,
        config: baseConfig(),
        options: { strict: false },
      });
      const { req, res, next } = makeCtx('/api/unknown/projects');
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(req.url).toBe('/api/unknown/projects'); // untouched
    });

    it('first segment matching a known model slug is treated as /api/:modelSlug', async () => {
      // When the consumer hits `/api/projects` (no org), the first segment IS
      // the model slug. The middleware must NOT treat "projects" as an org
      // slug — it should pass through so GlobalController sees it as :modelSlug.
      const prisma = makePrisma([{ id: 99, slug: 'projects' }]); // adversarial fixture
      const mw = createTenantRouteRewrite({
        prisma,
        config: baseConfig(['projects']),
      });
      const { req, res, next } = makeCtx('/api/projects');
      await mw(req, res, next);
      expect(req.url).toBe('/api/projects');
      expect(req.organization).toBeUndefined();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // BP-011: strict 404 on unknown or cross-tenant org
  // ------------------------------------------------------------------
  describe('BP-011 strict mode: 404 on unknown / cross-tenant', () => {
    it('unknown org slug → 404 NOT_FOUND', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/globex/projects');
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Organization not found' });
    });

    it('known org but user is not a member → 404 NOT_FOUND', async () => {
      const prisma = makePrisma(
        [{ id: 1, slug: 'acme' }, { id: 2, slug: 'globex' }],
        [{ userId: 1, organizationId: 1 }], // user 1 is member of acme only
      );
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/globex/projects', { id: 1 });
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Organization not found' });
    });

    it('membership check is skipped when req.user is absent (guard runs later)', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }], []); // no memberships
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects'); // no user
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.organization).toBeDefined();
      expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
    });

    it('enforceMembership: false skips the membership check even with req.user', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }], []); // not a member
      const mw = createTenantRouteRewrite({
        prisma,
        config: baseConfig(),
        options: { enforceMembership: false },
      });
      const { req, res, next } = makeCtx('/api/acme/projects', { id: 99 });
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.organization).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Caching
  // ------------------------------------------------------------------
  describe('org resolution is cached', () => {
    it('caches successful org lookups (single DB query across requests)', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });

      for (let i = 0; i < 5; i++) {
        const { req, res, next } = makeCtx('/api/acme/projects');
        await mw(req, res, next);
        expect(next).toHaveBeenCalled();
      }
      expect(prisma.organization.findFirst).toHaveBeenCalledTimes(1);
    });

    it('caches negative lookups too (prevents storm of DB queries for bad slugs)', async () => {
      const prisma = makePrisma([]);
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });

      for (let i = 0; i < 3; i++) {
        const { req, res, next } = makeCtx('/api/missing/projects');
        await mw(req, res, next);
      }
      expect(prisma.organization.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // Custom prefix + identifier column
  // ------------------------------------------------------------------
  describe('configuration options', () => {
    it('honors custom apiPrefix', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createTenantRouteRewrite({
        prisma,
        config: baseConfig(),
        options: { apiPrefix: 'v1' },
      });
      const { req, res, next } = makeCtx('/v1/acme/projects');
      await mw(req, res, next);
      expect(req.url).toBe('/v1/projects');
      expect(next).toHaveBeenCalled();
    });

    it('uses multiTenant.organizationIdentifierColumn for lookup', async () => {
      const prisma = makePrisma([{ id: 1, uuid: 'abc-123-def' }]);
      const cfg: RhinoConfig = {
        ...baseConfig(),
        multiTenant: { enabled: true, organizationIdentifierColumn: 'uuid' },
      };
      const mw = createTenantRouteRewrite({ prisma, config: cfg });
      const { req, res, next } = makeCtx('/api/abc-123-def/projects');
      await mw(req, res, next);
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({
        where: { uuid: 'abc-123-def' },
      });
      expect(next).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------
  describe('error handling', () => {
    it('forwards db errors to next() (Nest exception filter will handle)', async () => {
      const prisma: any = {
        organization: {
          findFirst: jest.fn().mockRejectedValue(new Error('db explode')),
        },
        userRole: { findFirst: jest.fn() },
      };
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects');
      await mw(req, res, next);
      // The inner catch swallows the findFirst rejection and treats it as "org not found"
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });

    it('tolerates prisma client without organization delegate (no-op)', async () => {
      const prisma: any = {}; // no .organization
      const mw = createTenantRouteRewrite({ prisma, config: baseConfig() });
      const { req, res, next } = makeCtx('/api/acme/projects');
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.organization).toBeUndefined();
    });
  });
});
