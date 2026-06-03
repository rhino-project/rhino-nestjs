import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { RouteGroupMiddleware } from '../../src/middleware/route-group.middleware';
import { createDomainRouteResolver } from '../../src/middleware/domain-route-resolver';
import { ResolveOrganizationMiddleware } from '../../src/middleware/resolve-organization.middleware';
import { OrganizationService } from '../../src/services/organization.service';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import type { RhinoConfig } from '../../src/interfaces/rhino-config.interface';

/**
 * End-to-end-ish exercise of host-based (domain) route-group resolution.
 *
 * The Nest harness used by the other e2e specs invokes controllers directly
 * against a mock Prisma (there is no real HTTP socket). To exercise the full
 * request flow for domain routing we run the actual middleware chain that the
 * module installs — RouteGroupMiddleware (host → group + subdomain capture),
 * the Express-level domain resolver (subdomain → org), and
 * ResolveOrganizationMiddleware — then hand off to GlobalController with the
 * resolved org context, mirroring what JwtAuthGuard + interceptors would do
 * around it.
 */
class PostPolicy extends ResourcePolicy {}

const baseModels = {
  posts: {
    model: 'post',
    policy: PostPolicy,
    belongsToOrganization: true,
    validation: z.object({ title: z.string().min(1) }),
  },
};

function tenantConfig(): RhinoConfig {
  return {
    models: baseModels,
    routeGroups: {
      tenant: { domain: '{organization}.example.com', models: '*' },
    },
    multiTenant: {
      enabled: true,
      organizationIdentifierColumn: 'slug',
      organizationModel: 'organization',
      userOrganizationModel: 'userRole',
    },
  } as RhinoConfig;
}

function makeRes() {
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
  return res;
}

/**
 * Run the middleware chain for a given host. Returns the (mutated) req plus the
 * captured response / next outcome.
 */
async function runChain(
  env: ReturnType<typeof buildEnv>,
  cfg: RhinoConfig,
  host: string,
  url = '/api/posts',
  user?: any,
) {
  const req: any = { url, originalUrl: url, hostname: host, params: {} };
  if (user) req.user = user;
  const res = makeRes();
  let chainError: any = undefined;
  let reachedHandler = false;

  // 1. RouteGroupMiddleware — host → __routeGroup, capture subdomain param.
  const routeGroupMw = new RouteGroupMiddleware(env.config);
  await new Promise<void>((resolve) => {
    routeGroupMw.use(req, res as any, (err?: any) => {
      if (err) chainError = err;
      resolve();
    });
  });
  if (chainError) return { req, res, chainError, reachedHandler };

  // 2. Express-level domain resolver — subdomain → req.organization.
  const domainMw = createDomainRouteResolver({ prisma: env.client, config: cfg });
  await domainMw(req, res as any, (err?: any) => {
    if (err) chainError = err;
  });
  if (chainError || res.statusCode !== 200) return { req, res, chainError, reachedHandler };

  // 3. ResolveOrganizationMiddleware — params.organization → req.organization
  //    (idempotent: the resolver may have already set it; this verifies the
  //    captured param flows through the standard middleware too).
  const orgSvc = new OrganizationService(env.prisma, env.config);
  const resolveOrgMw = new ResolveOrganizationMiddleware(orgSvc);
  try {
    await new Promise<void>((resolve, reject) => {
      resolveOrgMw.use(req, res as any, (err?: any) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    chainError = err;
    return { req, res, chainError, reachedHandler };
  }

  reachedHandler = true;
  return { req, res, chainError, reachedHandler };
}

describe('Domain-aware route groups (e2e flow)', () => {
  it('org-one.example.com resolves org-one and lists only its posts', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, {
      organization: [
        { id: 1, slug: 'org-one' },
        { id: 2, slug: 'org-two' },
      ],
      userRole: [{ userId: 10, organizationId: 1, permissions: ['posts.*'] }],
      post: [
        { id: 1, title: 'one-a', organizationId: 1 },
        { id: 2, title: 'one-b', organizationId: 1 },
        { id: 3, title: 'two-a', organizationId: 2 }, // must NOT leak
      ],
    });

    const user = { id: 10, userRoles: [{ organizationId: 1, permissions: ['posts.*'] }] };
    const { req, reachedHandler } = await runChain(env, cfg, 'org-one.example.com', '/api/posts', user);

    expect(reachedHandler).toBe(true);
    expect(req.__routeGroup).toBe('tenant');
    expect(req.params.organization).toBe('org-one');
    expect(req.organization).toMatchObject({ id: 1, slug: 'org-one' });

    const res: any = await env.controllers.global.index('posts', {}, {
      user,
      organization: req.organization,
    } as any);
    const items = res.__rhinoPaginated ? res.items : res;
    expect(items.map((r: any) => r.title).sort()).toEqual(['one-a', 'one-b']);
  });

  it('different subdomain selects a different org (org-two)', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, {
      organization: [
        { id: 1, slug: 'org-one' },
        { id: 2, slug: 'org-two' },
      ],
      userRole: [{ userId: 20, organizationId: 2 }],
      post: [{ id: 3, title: 'two-a', organizationId: 2 }],
    });
    const user = { id: 20 };
    const { req, reachedHandler } = await runChain(env, cfg, 'org-two.example.com', '/api/posts', user);
    expect(reachedHandler).toBe(true);
    expect(req.organization).toMatchObject({ id: 2, slug: 'org-two' });
  });

  it('unknown subdomain → 404 (org not found)', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, {
      organization: [{ id: 1, slug: 'org-one' }],
    });
    const { res, reachedHandler } = await runChain(env, cfg, 'ghost.example.com');
    expect(reachedHandler).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Organization not found' });
  });

  it('non-member user on a valid subdomain → 404', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, {
      organization: [{ id: 1, slug: 'org-one' }],
      userRole: [], // user is not a member
    });
    const { res, reachedHandler } = await runChain(
      env,
      cfg,
      'org-one.example.com',
      '/api/posts',
      { id: 999 },
    );
    expect(reachedHandler).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant: a member of org-one is denied (404) on org-two.example.com', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, {
      organization: [
        { id: 1, slug: 'org-one' },
        { id: 2, slug: 'org-two' },
      ],
      // user 10 is a member of org-one ONLY
      userRole: [{ userId: 10, organizationId: 1, permissions: ['posts.*'] }],
      post: [
        { id: 1, title: 'one-a', organizationId: 1 },
        { id: 3, title: 'two-a', organizationId: 2 },
      ],
    });
    const user = { id: 10, userRoles: [{ organizationId: 1, permissions: ['posts.*'] }] };

    // Requesting the OTHER tenant's host → cross-tenant denial (404, no enumeration).
    const denied = await runChain(env, cfg, 'org-two.example.com', '/api/posts', user);
    expect(denied.reachedHandler).toBe(false);
    expect(denied.res.statusCode).toBe(404);

    // The same user on their OWN tenant succeeds and sees only org-one data.
    const allowed = await runChain(env, cfg, 'org-one.example.com', '/api/posts', user);
    expect(allowed.reachedHandler).toBe(true);
    expect(allowed.req.organization).toMatchObject({ id: 1, slug: 'org-one' });
    const res: any = await env.controllers.global.index('posts', {}, {
      user,
      organization: allowed.req.organization,
    } as any);
    const items = res.__rhinoPaginated ? res.items : res;
    expect(items.map((r: any) => r.title).sort()).toEqual(['one-a']);
  });

  it('host not matching the parameterized apex → RouteGroupMiddleware 404s', async () => {
    const cfg = tenantConfig();
    const env = buildEnv(cfg, { organization: [{ id: 1, slug: 'org-one' }] });
    const { chainError, reachedHandler } = await runChain(env, cfg, 'org-one.elsewhere.io');
    expect(reachedHandler).toBe(false);
    expect(chainError).toBeDefined();
    expect(chainError.getStatus()).toBe(404);
  });

  describe('literal domain, wrong-host rejection', () => {
    const literalCfg: RhinoConfig = {
      models: baseModels,
      routeGroups: { admin: { domain: 'admin.example.com', models: '*' } },
      multiTenant: { enabled: false },
    } as RhinoConfig;

    it('matching host reaches the handler', async () => {
      const env = buildEnv(literalCfg, { post: [{ id: 1, title: 'a', organizationId: 1 }] });
      const { req, reachedHandler } = await runChain(env, literalCfg, 'admin.example.com');
      expect(reachedHandler).toBe(true);
      expect(req.__routeGroup).toBe('admin');
    });

    it('wrong host is rejected with 404', async () => {
      const env = buildEnv(literalCfg);
      const { chainError, reachedHandler } = await runChain(env, literalCfg, 'app.example.com');
      expect(reachedHandler).toBe(false);
      expect(chainError?.getStatus()).toBe(404);
    });
  });

  describe('two groups sharing a prefix, selected by host', () => {
    const cfg: RhinoConfig = {
      models: baseModels,
      routeGroups: {
        admin: { domain: 'admin.example.com', prefix: 'dash', models: '*' },
        public: { domain: 'public.example.com', prefix: 'dash', models: ['posts'], skipAuth: true },
      },
      multiTenant: { enabled: false },
    } as RhinoConfig;

    it('admin host → admin group, auth enforced (no skipAuth)', async () => {
      const env = buildEnv(cfg);
      const { req } = await runChain(env, cfg, 'admin.example.com', '/api/dash/posts');
      expect(req.__routeGroup).toBe('admin');
      expect(req.__skipAuth).toBeUndefined();
    });

    it('public host → public group with skipAuth', async () => {
      const env = buildEnv(cfg);
      const { req } = await runChain(env, cfg, 'public.example.com', '/api/dash/posts');
      expect(req.__routeGroup).toBe('public');
      expect(req.__skipAuth).toBe(true);
    });
  });
});
