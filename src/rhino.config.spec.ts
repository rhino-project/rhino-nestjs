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
    // Save/restore the real env var in a finally so a failed assertion can never
    // leak `JWT_SECRET` into the worker process and pollute other test files
    // that read it as a fallback in `authConfig()` (cross-file jest state leak).
    const had = Object.prototype.hasOwnProperty.call(process.env, 'JWT_SECRET');
    const prev = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = 'from-env';
      const service = new RhinoConfigService(normalizeConfig({ models: {} }));
      expect(service.authConfig().jwtSecret).toBe('from-env');
    } finally {
      if (had) process.env.JWT_SECRET = prev;
      else delete process.env.JWT_SECRET;
    }
  });

  describe('group-auth accessors', () => {
    it('enforceGroupMembership defaults to false and reflects the flag', () => {
      expect(new RhinoConfigService(normalizeConfig({ models: {} })).enforceGroupMembership()).toBe(false);
      expect(
        new RhinoConfigService(
          normalizeConfig({ models: {}, auth: { enforceGroupMembership: true } }),
        ).enforceGroupMembership(),
      ).toBe(true);
    });

    it('routeGroupAuthEnabled is per-group and false for unknown/null', () => {
      const s = new RhinoConfigService(
        normalizeConfig({
          models: {},
          routeGroups: {
            driver: { prefix: 'driver', auth: true, models: '*' },
            plain: { prefix: 'plain', models: '*' },
          },
        }),
      );
      expect(s.routeGroupAuthEnabled('driver')).toBe(true);
      expect(s.routeGroupAuthEnabled('plain')).toBe(false);
      expect(s.routeGroupAuthEnabled(null)).toBe(false);
    });

    it('authEnabledGroups excludes the public group', () => {
      const s = new RhinoConfigService(
        normalizeConfig({
          models: {},
          routeGroups: {
            driver: { prefix: 'driver', auth: true, models: '*' },
            public: { prefix: 'public', auth: true, models: '*' },
          },
        }),
      );
      expect(s.authEnabledGroups()).toEqual(['driver']);
    });

    it('routeGroupHooks returns the configured hooks value', () => {
      const obj = { afterLogin: () => undefined };
      const s = new RhinoConfigService(
        normalizeConfig({
          models: {},
          routeGroups: { driver: { prefix: 'driver', hooks: obj, models: '*' } },
        }),
      );
      expect(s.routeGroupHooks('driver')).toBe(obj);
      expect(s.routeGroupHooks(null)).toBeUndefined();
    });

    it('isTenantGroup honors explicit tenant flag and multiTenant default', () => {
      const s = new RhinoConfigService(
        normalizeConfig({
          models: {},
          multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
          routeGroups: {
            tenant: { prefix: 't', tenant: true, models: '*' },
            driver: { prefix: 'd', tenant: false, models: '*' },
            public: { prefix: 'p', models: '*' },
          },
        }),
      );
      expect(s.isTenantGroup('tenant')).toBe(true);
      expect(s.isTenantGroup('driver')).toBe(false);
      expect(s.isTenantGroup('public')).toBe(false);
      // unknown group → multiTenant default
      expect(s.isTenantGroup('whatever')).toBe(true);
    });

    it('isTenantGroup is false when multiTenant disabled and no override', () => {
      const s = new RhinoConfigService(normalizeConfig({ models: {} }));
      expect(s.isTenantGroup('anything')).toBe(false);
      expect(s.isTenantGroup(null)).toBe(false);
    });
  });
});
