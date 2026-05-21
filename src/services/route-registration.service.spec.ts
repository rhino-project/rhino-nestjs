import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { describeRoutes } from './route-registration.service';

describe('describeRoutes', () => {
  it('expands `*` groups to all registered models', () => {
    const cfg = new RhinoConfigService(
      normalizeConfig({
        models: {
          posts: { model: 'post' },
          comments: { model: 'comment', softDeletes: true },
        },
        routeGroups: {
          tenant: { prefix: ':organization', models: '*' },
        },
      }),
    );
    const routes = describeRoutes(cfg);
    expect(routes).toHaveLength(2);
    expect(routes.every((r) => r.group === 'tenant')).toBe(true);
    expect(routes.find((r) => r.slug === 'comments')?.softDeletes).toBe(true);
  });

  it('limits models to explicit list', () => {
    const cfg = new RhinoConfigService(
      normalizeConfig({
        models: { posts: { model: 'post' }, comments: { model: 'comment' } },
        routeGroups: {
          public: { prefix: 'public', models: ['posts'], skipAuth: true },
        },
      }),
    );
    const routes = describeRoutes(cfg);
    expect(routes).toHaveLength(1);
    expect(routes[0].slug).toBe('posts');
  });

  it('falls back to a default group when no routeGroups', () => {
    const cfg = new RhinoConfigService(
      normalizeConfig({ models: { posts: { model: 'post' } } }),
    );
    const routes = describeRoutes(cfg);
    expect(routes[0].group).toBe('(default)');
  });
});
