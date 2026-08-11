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

  describe('route key', () => {
    it('routeKeyFor defaults to id when nothing is configured', () => {
      const s = new RhinoConfigService(
        normalizeConfig({ models: { posts: { model: 'post' } } }),
      );
      expect(s.globalRouteKey()).toBe('id');
      expect(s.routeKeyFor('posts')).toBe('id');
      expect(s.routeKeyFor('unknown')).toBe('id');
    });

    it('per-model routeKey beats the global default', () => {
      const s = new RhinoConfigService(
        normalizeConfig({
          routeKey: 'uuid',
          models: {
            jobs: { model: 'job', routeKey: 'hashId' },
            posts: { model: 'post' },
          },
        }),
      );
      expect(s.routeKeyFor('jobs')).toBe('hashId');
      // global applies when the model is silent
      expect(s.routeKeyFor('posts')).toBe('uuid');
      expect(s.globalRouteKey()).toBe('uuid');
    });

    it('normalizeConfig throws on an empty-string global routeKey', () => {
      expect(() => normalizeConfig({ models: {}, routeKey: '' })).toThrow(
        /routeKey must be a non-empty string/,
      );
      expect(() => normalizeConfig({ models: {}, routeKey: '   ' })).toThrow(
        /routeKey must be a non-empty string/,
      );
      expect(() => normalizeConfig({ models: {}, routeKey: 42 as any })).toThrow(
        /routeKey must be a non-empty string/,
      );
    });

    it('normalizeConfig throws on an empty-string per-model routeKey (names the model)', () => {
      expect(() =>
        normalizeConfig({ models: { jobs: { model: 'job', routeKey: '' } } }),
      ).toThrow(/Model 'jobs'.*routeKey must be a non-empty string/);
    });

    it('normalizeConfig accepts valid route keys and no route keys', () => {
      expect(() =>
        normalizeConfig({
          routeKey: 'uuid',
          models: { jobs: { model: 'job', routeKey: 'hashId' } },
        }),
      ).not.toThrow();
      expect(() => normalizeConfig({ models: { jobs: { model: 'job' } } })).not.toThrow();
    });
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

  describe('owner chain resolution (orgPathFor)', () => {
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warnSpy.mockRestore());

    const service = (models: Record<string, any>) =>
      new RhinoConfigService(normalizeConfig({ models }));

    it('resolves a single hop to the org-scoped root', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'project' },
      });
      expect(s.orgPathFor('tasks')).toEqual(['project']);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('resolves a two-hop chain (comments → task → project)', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'project' },
        comments: { model: 'Comment', owner: 'task' },
      });
      expect(s.orgPathFor('comments')).toEqual(['task', 'project']);
      expect(s.orgPathFor('tasks')).toEqual(['project']);
    });

    it('matches the owning registration by model name case-insensitively', () => {
      const s = service({
        workspaces: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'project' },
      });
      // slug 'workspaces' would never match 'project' — the model name does.
      expect(s.orgPathFor('tasks')).toEqual(['project']);
    });

    it('falls back to slug matching with naive pluralization', () => {
      const s = service({
        projects: { model: 'ProjectRecord', belongsToOrganization: true },
        categories: { model: 'CategoryRecord', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'project' },
        posts: { model: 'Post', owner: 'category' },
      });
      expect(s.orgPathFor('tasks')).toEqual(['project']); // project → projects
      expect(s.orgPathFor('posts')).toEqual(['category']); // category → categories
    });

    it('supports a dot-notated owner chain (task.project)', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task' }, // no owner of its own
        comments: { model: 'Comment', owner: 'task.project' },
      });
      expect(s.orgPathFor('comments')).toEqual(['task', 'project']);
    });

    it('accepts a legacy FK-column owner (userId → relation user)', () => {
      const s = service({
        users: { model: 'User', belongsToOrganization: true },
        profiles: { model: 'Profile', owner: 'userId' },
      });
      expect(s.orgPathFor('profiles')).toEqual(['user']);
    });

    it('unknown owner → warns at boot and resolves to null (unscoped)', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'nonexistent' },
      });
      expect(s.orgPathFor('tasks')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Model 'tasks': owner chain could not be resolved"),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("owner 'nonexistent' does not name a registered model"),
      );
    });

    it('cycle → warns and resolves to null instead of hanging', () => {
      const s = service({
        as: { model: 'A', owner: 'b' },
        bs: { model: 'B', owner: 'a' },
      });
      expect(s.orgPathFor('as')).toBeNull();
      expect(s.orgPathFor('bs')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cycle detected'));
    });

    it('chain that dead-ends before an org-scoped registration → warns and resolves to null', () => {
      const s = service({
        projects: { model: 'Project' }, // NOT org-scoped, no owner
        tasks: { model: 'Task', owner: 'project' },
      });
      expect(s.orgPathFor('tasks')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dead-ends'));
    });

    it('owner + belongsToOrganization → direct scoping wins, no path, no warning', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tasks: { model: 'Task', owner: 'project', belongsToOrganization: true },
      });
      expect(s.orgPathFor('tasks')).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('models without owner resolve to null with no warning', () => {
      const s = service({
        projects: { model: 'Project', belongsToOrganization: true },
        tags: { model: 'Tag' },
      });
      expect(s.orgPathFor('projects')).toBeNull();
      expect(s.orgPathFor('tags')).toBeNull();
      expect(s.orgPathFor('unknown')).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('self-referencing owner → warns as a cycle, never loops', () => {
      const s = service({
        folders: { model: 'Folder', owner: 'folder' },
      });
      expect(s.orgPathFor('folders')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cycle detected'));
    });
  });
});
