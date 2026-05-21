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
});
