import { RouteGroupMiddleware } from './route-group.middleware';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';

function makeMw(groups: any) {
  const config = new RhinoConfigService(normalizeConfig({ models: {}, routeGroups: groups }));
  return new RouteGroupMiddleware(config);
}

describe('RouteGroupMiddleware', () => {
  it('sets __routeGroup and __skipAuth for a matching public prefix', () => {
    const mw = makeMw({ public: { prefix: 'public', models: ['posts'], skipAuth: true } });
    const req: any = { originalUrl: '/api/public/posts' };
    const next = jest.fn();
    mw.use(req, {} as any, next);
    expect(req.__routeGroup).toBe('public');
    expect(req.__skipAuth).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('does not set skipAuth when the group has no skipAuth', () => {
    const mw = makeMw({ admin: { prefix: 'admin', models: '*' } });
    const req: any = { originalUrl: '/api/admin/posts' };
    mw.use(req, {} as any, jest.fn());
    expect(req.__routeGroup).toBe('admin');
    expect(req.__skipAuth).toBeUndefined();
  });

  it('ignores dynamic :organization prefixes', () => {
    const mw = makeMw({
      tenant: { prefix: ':organization', models: '*' },
      public: { prefix: 'public', models: ['posts'], skipAuth: true },
    });
    const req: any = { originalUrl: '/api/acme/posts' };
    mw.use(req, {} as any, jest.fn());
    expect(req.__routeGroup).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // BP-006: use req.originalUrl, not req.url (which is mount-relative)
  // -------------------------------------------------------------------
  describe('BP-006: uses req.originalUrl for prefix matching', () => {
    it("matches via req.originalUrl when req.url is '/' (Express strips it at middleware mount points)", () => {
      const mw = makeMw({ auth: { prefix: 'auth', models: [], skipAuth: true } });
      // This is the exact shape produced by NestJS wiring `consumer.apply(mw).forRoutes('*')`
      const req: any = { url: '/', originalUrl: '/api/auth/login' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__routeGroup).toBe('auth');
      expect(req.__skipAuth).toBe(true);
    });

    it("matches via req.originalUrl when req.url is a stripped sub-path", () => {
      const mw = makeMw({ admin: { prefix: 'admin', models: '*' } });
      const req: any = { url: '/posts/42', originalUrl: '/api/admin/posts/42' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__routeGroup).toBe('admin');
    });

    it('falls back to req.url when originalUrl is missing', () => {
      const mw = makeMw({ api: { prefix: 'api', models: [], skipAuth: false } });
      const req: any = { url: '/api/health' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__routeGroup).toBe('api');
    });

    it('handles missing both url and originalUrl without throwing', () => {
      const mw = makeMw({ admin: { prefix: 'admin', models: '*' } });
      const req: any = {};
      expect(() => mw.use(req, {} as any, jest.fn())).not.toThrow();
      expect(req.__routeGroup).toBeUndefined();
    });

    it('strips query strings before matching', () => {
      const mw = makeMw({ public: { prefix: 'public', models: [], skipAuth: true } });
      const req: any = { originalUrl: '/api/public/search?q=hello&page=2' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__skipAuth).toBe(true);
    });

    it('prefers originalUrl over url when both are present and differ', () => {
      const mw = makeMw({
        // `admin` and `public` both could theoretically match depending on which URL we read
        admin: { prefix: 'admin', models: [] },
        public: { prefix: 'public', models: [], skipAuth: true },
      });
      const req: any = { url: '/api/admin/posts', originalUrl: '/api/public/posts' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__routeGroup).toBe('public');
      expect(req.__skipAuth).toBe(true);
    });

    it('does not false-match when the group prefix appears only as a sub-word', () => {
      const mw = makeMw({ auth: { prefix: 'auth', models: [], skipAuth: true } });
      // `/api/authors/1` contains the string `auth` but not as a path segment
      const req: any = { originalUrl: '/api/authors/1' };
      mw.use(req, {} as any, jest.fn());
      expect(req.__routeGroup).toBeUndefined();
      expect(req.__skipAuth).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // Domain-aware route groups
  // -------------------------------------------------------------------
  describe('domain-aware route groups', () => {
    describe('literal domain', () => {
      it('sets __routeGroup when req.hostname matches the literal domain', () => {
        const mw = makeMw({
          admin: { domain: 'admin.example.com', models: '*' },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'admin.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBe('admin');
        expect(next).toHaveBeenCalledWith();
      });

      it('rejects with 404 when the host does NOT match a domain-scoped group', () => {
        const mw = makeMw({
          admin: { domain: 'admin.example.com', models: '*' },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'app.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBeUndefined();
        // 404 is signalled by forwarding a NotFoundException to next().
        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.getStatus()).toBe(404);
      });

      it('falls back to the Host header when req.hostname is absent', () => {
        const mw = makeMw({ admin: { domain: 'admin.example.com', models: '*' } });
        const req: any = {
          originalUrl: '/api/posts',
          headers: { host: 'admin.example.com:3000' },
        };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('admin');
      });

      it('propagates skipAuth on a domain group', () => {
        const mw = makeMw({
          marketing: { domain: 'www.example.com', models: ['posts'], skipAuth: true },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'www.example.com' };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('marketing');
        expect(req.__skipAuth).toBe(true);
      });

      it('combines domain + prefix: matches only when BOTH host and prefix match', () => {
        const mw = makeMw({
          admin: { domain: 'admin.example.com', prefix: 'v2', models: '*' },
        });
        const ok: any = { originalUrl: '/api/v2/posts', hostname: 'admin.example.com' };
        mw.use(ok, {} as any, jest.fn());
        expect(ok.__routeGroup).toBe('admin');

        // right host, wrong prefix -> not matched, not blocked (prefix didn't match)
        const wrongPrefix: any = { originalUrl: '/api/posts', hostname: 'admin.example.com' };
        const next2 = jest.fn();
        mw.use(wrongPrefix, {} as any, next2);
        expect(wrongPrefix.__routeGroup).toBeUndefined();
        expect(next2).toHaveBeenCalledWith();
      });
    });

    describe('two groups, same prefix, different domains', () => {
      const groups = {
        admin: { domain: 'admin.example.com', prefix: 'dashboard', models: '*' },
        public: {
          domain: 'public.example.com',
          prefix: 'dashboard',
          models: ['posts'],
          skipAuth: true,
        },
      };

      it('host selects the admin group', () => {
        const mw = makeMw(groups);
        const req: any = { originalUrl: '/api/dashboard/posts', hostname: 'admin.example.com' };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('admin');
        expect(req.__skipAuth).toBeUndefined();
      });

      it('host selects the public group (and its skipAuth)', () => {
        const mw = makeMw(groups);
        const req: any = { originalUrl: '/api/dashboard/posts', hostname: 'public.example.com' };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('public');
        expect(req.__skipAuth).toBe(true);
      });

      it('a third, unrelated host is rejected (404)', () => {
        const mw = makeMw(groups);
        const req: any = { originalUrl: '/api/dashboard/posts', hostname: 'other.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBeUndefined();
        expect(next.mock.calls[0][0]?.getStatus()).toBe(404);
      });
    });

    describe('parameterized domain', () => {
      it('captures the subdomain and exposes it as req.params.organization', () => {
        const mw = makeMw({
          tenant: { domain: '{organization}.example.com', models: '*' },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'org-one.example.com', params: {} };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('tenant');
        expect(req.params.organization).toBe('org-one');
        expect(req.__domainParams).toEqual({ organization: 'org-one' });
      });

      it('does not clobber an existing path param of the same name', () => {
        const mw = makeMw({ tenant: { domain: '{organization}.example.com', models: '*' } });
        const req: any = {
          originalUrl: '/api/posts',
          hostname: 'org-one.example.com',
          params: { organization: 'from-path' },
        };
        mw.use(req, {} as any, jest.fn());
        expect(req.params.organization).toBe('from-path');
      });

      it('maps an {org} param to organization too', () => {
        const mw = makeMw({ tenant: { domain: '{org}.example.com', models: '*' } });
        const req: any = { originalUrl: '/api/posts', hostname: 'acme.example.com', params: {} };
        mw.use(req, {} as any, jest.fn());
        expect(req.params.organization).toBe('acme');
      });

      it('rejects (404) when the host does not match the parameterized apex', () => {
        const mw = makeMw({ tenant: { domain: '{organization}.example.com', models: '*' } });
        const req: any = { originalUrl: '/api/posts', hostname: 'org.elsewhere.com', params: {} };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBeUndefined();
        expect(next.mock.calls[0][0]?.getStatus()).toBe(404);
      });
    });

    describe('backward compatibility / mixed configs', () => {
      it('domain-scoped match takes precedence over a plain prefix match', () => {
        const mw = makeMw({
          // plain prefix group that would match /api/posts via empty-ish matching
          legacy: { prefix: 'posts', models: '*' },
          admin: { domain: 'admin.example.com', prefix: 'posts', models: '*', skipAuth: true },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'admin.example.com' };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('admin');
        expect(req.__skipAuth).toBe(true);
      });

      it('plain prefix group still works when no domain group matches the host', () => {
        const mw = makeMw({
          admin: { domain: 'admin.example.com', prefix: 'admindash', models: '*' },
          api: { prefix: 'public', models: ['posts'], skipAuth: true },
        });
        // host doesn't match admin's domain, and the path targets the plain `public` group
        const req: any = { originalUrl: '/api/public/posts', hostname: 'app.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBe('api');
        expect(req.__skipAuth).toBe(true);
        expect(next).toHaveBeenCalledWith();
      });

      it('a non-domain prefix group is NOT blocked when an unrelated domain group exists', () => {
        // The domain group has a different prefix, so /api/public/posts never
        // looked like the domain group -> no spurious 404.
        const mw = makeMw({
          admin: { domain: 'admin.example.com', prefix: 'admindash', models: '*' },
          api: { prefix: 'public', models: ['posts'] },
        });
        const req: any = { originalUrl: '/api/public/posts', hostname: 'whatever.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBe('api');
        expect(next).toHaveBeenCalledWith();
      });

      // -----------------------------------------------------------------
      // Regression: BLOCKER 1 — skipAuth must NOT leak across precedence.
      // -----------------------------------------------------------------
      it('does NOT leak skipAuth from a losing prefix group to the winning domain group', () => {
        const mw = makeMw({
          // plain prefix group with skipAuth that matches the path first
          pub: { prefix: 'posts', skipAuth: true, models: ['posts'] },
          // auth-required domain group sharing the prefix; wins by host
          admin: { domain: 'admin.example.com', prefix: 'posts', models: '*' },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'admin.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBe('admin');
        // The auth-required group won → must NOT be served unauthenticated.
        expect(req.__skipAuth).toBeUndefined();
        expect(next).toHaveBeenCalledWith();
      });

      // -----------------------------------------------------------------
      // Regression: BLOCKER 2 — empty-prefix domain group must not 404 a
      // request that a non-domain group can serve.
      // -----------------------------------------------------------------
      it('an empty-prefix domain group does not block a request a non-domain group serves', () => {
        const mw = makeMw({
          tenant: { domain: '{organization}.example.com', models: '*' },
          api: { prefix: 'public', models: ['posts'] },
        });
        // Host matches neither the parameterized apex; path targets `api`.
        const req: any = { originalUrl: '/api/public/posts', hostname: 'foo.other.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBe('api');
        expect(next).toHaveBeenCalledWith();
      });

      it('a catch-all (empty-prefix) non-domain group serves a wrong-host request instead of 404', () => {
        const mw = makeMw({
          tenant: { domain: '{organization}.example.com', models: '*' },
          // empty-prefix non-domain group: eligible for any path
          api: { models: ['posts'] },
        });
        // Host doesn't match the parameterized apex, but the catch-all `api`
        // group can serve it → must NOT 404 (BLOCKER 2's exact repro).
        const req: any = { originalUrl: '/api/posts', hostname: 'foo.other.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(next).toHaveBeenCalledWith();
      });

      it('wrong host still 404s when no non-domain group is eligible for the path', () => {
        const mw = makeMw({
          tenant: { domain: '{organization}.example.com', models: '*' },
          // non-domain group exists but its prefix does not match this path
          api: { prefix: 'public', models: ['posts'] },
        });
        const req: any = { originalUrl: '/api/posts', hostname: 'foo.other.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBeUndefined();
        expect(next.mock.calls[0][0]?.getStatus()).toBe(404);
      });

      // -----------------------------------------------------------------
      // Regression: SHOULD-FIX 3 — captured subdomain is case-normalized.
      // -----------------------------------------------------------------
      it('lowercases the captured subdomain for org resolution', () => {
        const mw = makeMw({ tenant: { domain: '{organization}.example.com', models: '*' } });
        const req: any = { originalUrl: '/api/posts', hostname: 'ACME.example.com', params: {} };
        mw.use(req, {} as any, jest.fn());
        expect(req.__routeGroup).toBe('tenant');
        expect(req.params.organization).toBe('acme');
        expect(req.__domainParams).toEqual({ organization: 'acme' });
      });

      it('still ignores dynamic :organization prefixes (no domains configured)', () => {
        const mw = makeMw({
          tenant: { prefix: ':organization', models: '*' },
          public: { prefix: 'public', models: ['posts'], skipAuth: true },
        });
        const req: any = { originalUrl: '/api/acme/posts', hostname: 'app.example.com' };
        const next = jest.fn();
        mw.use(req, {} as any, next);
        expect(req.__routeGroup).toBeUndefined();
        expect(next).toHaveBeenCalledWith();
      });
    });
  });
});
