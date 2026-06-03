import { createDomainRouteResolver } from './domain-route-resolver';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

function makeCtx(host: string, url = '/api/posts', user?: any) {
  const req: any = { url, originalUrl: url, hostname: host, params: {} };
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
  };
}

function config(routeGroups: Record<string, any>, models: string[] = ['posts']): RhinoConfig {
  return {
    models: Object.fromEntries(models.map((s) => [s, { model: s }])),
    routeGroups,
    multiTenant: {
      enabled: true,
      organizationIdentifierColumn: 'slug',
      organizationModel: 'organization',
      userOrganizationModel: 'userRole',
    },
  };
}

describe('createDomainRouteResolver', () => {
  it('is a no-op when no route group declares a domain', async () => {
    const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
    const mw = createDomainRouteResolver({
      prisma,
      config: config({ tenant: { prefix: ':organization', models: '*' } }),
    });
    const { req, res, next } = makeCtx('acme.example.com');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.organization).toBeUndefined();
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  describe('literal domain', () => {
    it('marks __routeGroup and passes through without org resolution', async () => {
      const prisma = makePrisma();
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ admin: { domain: 'admin.example.com', models: '*' } }),
      });
      const { req, res, next } = makeCtx('admin.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.__routeGroup).toBe('admin');
      expect(req.organization).toBeUndefined();
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });

    it('propagates skipAuth', async () => {
      const prisma = makePrisma();
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ marketing: { domain: 'www.example.com', models: '*', skipAuth: true } }),
      });
      const { req, res, next } = makeCtx('www.example.com');
      await mw(req, res, next);
      expect(req.__skipAuth).toBe(true);
    });

    it('passes through when the host matches no domain group', async () => {
      const prisma = makePrisma();
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ admin: { domain: 'admin.example.com', models: '*' } }),
      });
      const { req, res, next } = makeCtx('app.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.__routeGroup).toBeUndefined();
    });
  });

  describe('parameterized domain (subdomain multitenancy)', () => {
    const groups = { tenant: { domain: '{organization}.example.com', models: '*' } };

    it('resolves org-one from org-one.example.com', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('org-one.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.__routeGroup).toBe('tenant');
      expect(req.params.organization).toBe('org-one');
      expect(req.organization).toEqual({ id: 1, slug: 'org-one' });
      expect(req.__orgSubdomain).toBe('org-one');
    });

    it('looks up by the configured identifier column', async () => {
      const prisma = makePrisma([{ id: 7, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('org-one.example.com');
      await mw(req, res, next);
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { slug: 'org-one' } });
    });

    it('unknown subdomain → 404 (strict default)', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('ghost.example.com');
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Organization not found' });
    });

    it('unknown subdomain passes through when strict: false', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({
        prisma,
        config: config(groups),
        options: { strict: false },
      });
      const { req, res, next } = makeCtx('ghost.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(res.statusCode).toBe(200);
      expect(req.organization).toBeUndefined();
    });

    it('non-member user → 404', async () => {
      const prisma = makePrisma(
        [{ id: 1, slug: 'org-one' }],
        [], // no memberships
      );
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('org-one.example.com', '/api/posts', { id: 42 });
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });

    it('member user → resolves org', async () => {
      const prisma = makePrisma(
        [{ id: 1, slug: 'org-one' }],
        [{ userId: 42, organizationId: 1 }],
      );
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('org-one.example.com', '/api/posts', { id: 42 });
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.organization).toEqual({ id: 1, slug: 'org-one' });
    });

    it('membership check skipped when req.user absent', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }], []);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('org-one.example.com'); // no user
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.organization).toBeDefined();
      expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
    });

    it('enforceMembership: false resolves even for non-members', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }], []);
      const mw = createDomainRouteResolver({
        prisma,
        config: config(groups),
        options: { enforceMembership: false },
      });
      const { req, res, next } = makeCtx('org-one.example.com', '/api/posts', { id: 99 });
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.organization).toBeDefined();
    });

    it('lowercases the captured subdomain before lookup, cache key, and param', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'acme' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('ACME.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { slug: 'acme' } });
      expect(req.params.organization).toBe('acme');
      expect(req.organization).toEqual({ id: 1, slug: 'acme' });
      expect(req.__orgSubdomain).toBe('acme');
    });

    it('does not clobber an existing organization path param', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'from-host' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      const { req, res, next } = makeCtx('from-host.example.com');
      req.params.organization = 'from-path';
      await mw(req, res, next);
      expect(req.params.organization).toBe('from-path');
    });
  });

  describe('caching', () => {
    const groups = { tenant: { domain: '{organization}.example.com', models: '*' } };

    it('caches successful org lookups across requests', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({ prisma, config: config(groups) });
      for (let i = 0; i < 4; i++) {
        const { req, res, next } = makeCtx('org-one.example.com');
        await mw(req, res, next);
      }
      expect(prisma.organization.findFirst).toHaveBeenCalledTimes(1);
    });

    it('caches negative lookups', async () => {
      const prisma = makePrisma([]);
      const mw = createDomainRouteResolver({
        prisma,
        config: config(groups),
        options: { strict: false },
      });
      for (let i = 0; i < 3; i++) {
        const { req, res, next } = makeCtx('ghost.example.com');
        await mw(req, res, next);
      }
      expect(prisma.organization.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('host resolution', () => {
    it('falls back to the Host header when hostname is absent', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ tenant: { domain: '{organization}.example.com', models: '*' } }),
      });
      const req: any = {
        url: '/api/posts',
        originalUrl: '/api/posts',
        params: {},
        headers: { host: 'org-one.example.com:8080' },
      };
      const res: any = { statusCode: 200, status(c: number) { res.statusCode = c; return res; }, json() { return res; } };
      const next = jest.fn();
      await mw(req, res, next);
      expect(req.organization).toEqual({ id: 1, slug: 'org-one' });
    });

    it('passes through when no host can be resolved', async () => {
      const prisma = makePrisma([{ id: 1, slug: 'org-one' }]);
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ tenant: { domain: '{organization}.example.com', models: '*' } }),
      });
      const req: any = { url: '/api/posts', params: {}, headers: {} };
      const res: any = { statusCode: 200, status(c: number) { res.statusCode = c; return res; }, json() { return res; } };
      const next = jest.fn();
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('error handling', () => {
    it('forwards unexpected errors to next(err)', async () => {
      const prisma: any = {
        organization: { findFirst: jest.fn().mockRejectedValue(new Error('boom')) },
        userRole: { findFirst: jest.fn() },
      };
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ tenant: { domain: '{organization}.example.com', models: '*' } }),
      });
      const { req, res, next } = makeCtx('org-one.example.com');
      await mw(req, res, next);
      // findFirst rejection is swallowed → treated as "not found" → strict 404
      expect(res.statusCode).toBe(404);
    });

    it('passes through when prisma has no organization delegate', async () => {
      const prisma: any = {};
      const mw = createDomainRouteResolver({
        prisma,
        config: config({ tenant: { domain: '{organization}.example.com', models: '*' } }),
      });
      const { req, res, next } = makeCtx('org-one.example.com');
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.organization).toBeUndefined();
    });
  });
});
