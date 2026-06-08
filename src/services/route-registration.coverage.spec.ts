import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { applyRhinoRouting, describeRoutes } from './route-registration.service';

// Coverage for route description + the applyRhinoRouting prefix/auth defaults.
describe('route-registration — coverage', () => {
  const cfg = (c: any) => new RhinoConfigService(normalizeConfig(c));

  describe('applyRhinoRouting', () => {
    it('applies a custom prefix and returns it', () => {
      const app: any = { setGlobalPrefix: jest.fn() };
      const res = applyRhinoRouting(app, { prefix: 'v1' });
      expect(app.setGlobalPrefix).toHaveBeenCalledWith('v1');
      expect(res.prefix).toBe('v1');
    });

    it('defaults the prefix to "api" and enableAuth to true', () => {
      const app: any = { setGlobalPrefix: jest.fn() };
      const res = applyRhinoRouting(app, {});
      expect(res.prefix).toBe('api');
      expect(res.enableAuth).toBe(true);
    });

    it('honours enableAuth: false', () => {
      const app: any = { setGlobalPrefix: jest.fn() };
      expect(applyRhinoRouting(app, { enableAuth: false }).enableAuth).toBe(false);
    });
  });

  describe('describeRoutes', () => {
    it('skips group models that are not in the registry', () => {
      const routes = describeRoutes(
        cfg({
          models: { posts: { model: 'post' } },
          routeGroups: { tenant: { prefix: 'tenant', models: ['posts', 'nonexistent'] } },
        }),
      );
      expect(routes).toHaveLength(1);
      expect(routes[0].slug).toBe('posts');
    });

    it('expands a model into every group that references it', () => {
      const routes = describeRoutes(
        cfg({
          models: { posts: { model: 'post', softDeletes: true } },
          routeGroups: {
            publicg: { prefix: 'public', models: '*' },
            admin: { prefix: 'admin', models: '*' },
          },
        }),
      );
      expect(routes).toHaveLength(2);
      expect(routes.every((r) => r.softDeletes === true)).toBe(true);
      expect(routes.map((r) => r.group).sort()).toEqual(['admin', 'publicg']);
    });

    it('carries softDeletes / hasAuditTrail / exceptActions per model', () => {
      const routes = describeRoutes(
        cfg({
          models: { posts: { model: 'post', softDeletes: true, hasAuditTrail: true, exceptActions: ['destroy'] } },
          routeGroups: { api: { prefix: 'api', models: '*' } },
        }),
      );
      expect(routes[0]).toMatchObject({
        softDeletes: true,
        hasAuditTrail: true,
        exceptActions: ['destroy'],
      });
    });

    it('falls back to a (default) group when no route groups are configured', () => {
      const routes = describeRoutes(cfg({ models: { posts: { model: 'post' } } }));
      expect(routes).toHaveLength(1);
      expect(routes[0].group).toBe('(default)');
      expect(routes[0].prefix).toBe('');
      expect(routes[0].domain).toBeNull();
    });
  });
});
