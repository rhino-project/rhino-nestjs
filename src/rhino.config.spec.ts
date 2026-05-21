import { RhinoConfigService, normalizeConfig } from './rhino.config';

describe('RhinoConfigService', () => {
  it('applies defaults for nested/invitations/auth', () => {
    const cfg = normalizeConfig({ models: { posts: { model: 'post' } } });
    expect(cfg.nested?.path).toBe('nested');
    expect(cfg.nested?.maxOperations).toBe(50);
    expect(cfg.invitations?.expiresDays).toBe(7);
    expect(cfg.auth?.jwtExpiresIn).toBe('7d');
  });

  it('preserves user-supplied overrides', () => {
    const cfg = normalizeConfig({
      models: {},
      nested: { maxOperations: 10 },
      invitations: { expiresDays: 30 },
    });
    expect(cfg.nested?.maxOperations).toBe(10);
    expect(cfg.invitations?.expiresDays).toBe(30);
  });

  it('looks up models by slug', () => {
    const service = new RhinoConfigService(
      normalizeConfig({ models: { posts: { model: 'post' } } }),
    );
    expect(service.hasModel('posts')).toBe(true);
    expect(service.hasModel('nope')).toBe(false);
    expect(service.model('posts')?.model).toBe('post');
  });

  it('expands route group model list', () => {
    const service = new RhinoConfigService(
      normalizeConfig({
        models: { posts: { model: 'post' }, tags: { model: 'tag' } },
        routeGroups: { tenant: { prefix: ':organization', models: '*' } },
      }),
    );
    expect(service.modelsInRouteGroup('tenant')).toEqual(['posts', 'tags']);
  });

  it('multiTenantEnabled responds to identifier column or explicit flag', () => {
    const a = new RhinoConfigService(
      normalizeConfig({ models: {}, multiTenant: { organizationIdentifierColumn: 'slug' } }),
    );
    expect(a.multiTenantEnabled()).toBe(true);
    const b = new RhinoConfigService(normalizeConfig({ models: {} }));
    expect(b.multiTenantEnabled()).toBe(false);
  });

  it('authConfig falls back to env JWT_SECRET', () => {
    process.env.JWT_SECRET = 'from-env';
    const service = new RhinoConfigService(normalizeConfig({ models: {} }));
    expect(service.authConfig().jwtSecret).toBe('from-env');
    delete process.env.JWT_SECRET;
  });
});
