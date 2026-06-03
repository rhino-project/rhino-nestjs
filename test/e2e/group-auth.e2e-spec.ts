import { buildEnv } from '../helpers/make-controller';
import { RhinoAuthRejected } from '../../src/errors/rhino-exception';
import { RouteGroupMiddleware } from '../../src/middleware/route-group.middleware';
import { RhinoConfigService, normalizeConfig } from '../../src/rhino.config';
import type {
  AuthLifecycleHooks,
  RhinoConfig,
} from '../../src/interfaces/rhino-config.interface';

/**
 * Group-aware auth + lifecycle hooks (design §5, §7) exercised through the
 * AuthController against the mock Prisma harness. The controller reads the
 * resolved group from `req.__routeGroup` (set by RouteGroupMiddleware in a real
 * request); here we set it explicitly to mirror each group's resolution.
 */
describe('Group-aware auth + lifecycle hooks', () => {
  async function seedUser(env: any, email = 'a@b.c', password = 'secret') {
    const hashed = await env.auth.hashPassword(password);
    env.client._data.user = [
      {
        id: 1,
        email,
        password: hashed,
        userRoles: [{ organization: { slug: 'acme' }, role: { slug: 'driver' } }],
      },
    ];
  }

  function reqFor(group: string | null, extra: any = {}) {
    return { __routeGroup: group, ...extra };
  }

  describe('group resolution by prefix / host (design §5)', () => {
    function resolveGroup(cfg: RhinoConfig, req: any): string | null {
      const mw = new RouteGroupMiddleware(
        new RhinoConfigService(normalizeConfig(cfg)),
      );
      let resolved: string | null = null;
      mw.use(req, {} as any, () => {
        resolved = req.__routeGroup ?? null;
      });
      return resolved;
    }

    const cfg: RhinoConfig = {
      models: { posts: { model: 'post' } },
      routeGroups: {
        driver: { prefix: 'driver', auth: true, models: '*' },
        admin: { domain: 'admin.example.com', auth: true, models: '*' },
      },
    } as RhinoConfig;

    it('resolves the group from the URL prefix for an auth request', () => {
      expect(
        resolveGroup(cfg, { originalUrl: '/api/driver/auth/login', headers: {} }),
      ).toBe('driver');
    });

    it('resolves the group from the host for a domain auth request', () => {
      expect(
        resolveGroup(cfg, {
          originalUrl: '/api/auth/login',
          hostname: 'admin.example.com',
          headers: { host: 'admin.example.com' },
        }),
      ).toBe('admin');
    });

    it('the legacy unprefixed auth path resolves to no group (default/global)', () => {
      expect(
        resolveGroup(cfg, { originalUrl: '/api/auth/login', headers: {} }),
      ).toBeNull();
    });
  });

  describe('default / global path (no group)', () => {
    it('login still works with no group and no hooks', async () => {
      const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
      await seedUser(env);
      const res = await env.controllers.auth.login(
        { email: 'a@b.c', password: 'secret' },
        reqFor(null),
      );
      expect(res.token).toBeTruthy();
      expect(res.organization_slug).toBe('acme');
    });
  });

  describe('afterLogin', () => {
    it('fires with the resolved group + token context', async () => {
      let seen: any = null;
      const hooks: AuthLifecycleHooks = { afterLogin: (c) => void (seen = c) };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      const res = await env.controllers.auth.login(
        { email: 'a@b.c', password: 'secret' },
        reqFor('driver'),
      );
      expect(res.token).toBeTruthy();
      expect(seen.routeGroup).toBe('driver');
      expect(seen.token).toBe(res.token);
      expect(seen.user.email).toBe('a@b.c');
    });

    it('reject revokes the issued token and returns the hook status', async () => {
      const hooks: AuthLifecycleHooks = {
        afterLogin: () => {
          throw new RhinoAuthRejected('blocked', 403);
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      await expect(
        env.controllers.auth.login({ email: 'a@b.c', password: 'secret' }, reqFor('driver')),
      ).rejects.toThrow(RhinoAuthRejected);
      // The token was revoked (recorded in the denylist).
      expect(env.client._data.revokedToken).toHaveLength(1);
    });

    // FIX 5: bounded guarantee — on hook rejection the token is NEVER returned
    // to the client, regardless of whether a denylist model exists. The reject
    // path throws; no token-bearing value ever resolves.
    it('never returns the token to the client when the hook rejects', async () => {
      const hooks: AuthLifecycleHooks = {
        afterLogin: () => {
          throw new RhinoAuthRejected('blocked', 403);
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      const result = await env.controllers.auth
        .login({ email: 'a@b.c', password: 'secret' }, reqFor('driver'))
        .then(
          (r) => ({ resolved: r }),
          (e) => ({ rejected: e }),
        );
      // The call rejected — no resolved value, so no token could leak.
      expect((result as any).resolved).toBeUndefined();
      expect((result as any).rejected).toBeInstanceOf(RhinoAuthRejected);
      expect(JSON.stringify((result as any).rejected ?? {})).not.toContain('token');
    });

    it('hook may set a custom status (e.g. 401)', async () => {
      const hooks: AuthLifecycleHooks = {
        afterLogin: () => {
          throw new RhinoAuthRejected('nope', 401);
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      try {
        await env.controllers.auth.login(
          { email: 'a@b.c', password: 'secret' },
          reqFor('driver'),
        );
        fail('expected rejection');
      } catch (e: any) {
        expect(e.getStatus()).toBe(401);
      }
    });

    it('a non-rejecting hook is a no-op (login succeeds normally)', async () => {
      const hooks: AuthLifecycleHooks = { afterLogin: () => undefined };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      const res = await env.controllers.auth.login(
        { email: 'a@b.c', password: 'secret' },
        reqFor('driver'),
      );
      expect(res.token).toBeTruthy();
      expect(env.client._data.revokedToken).toBeUndefined();
    });

    // FIX 7 (doc): a hook must throw RhinoAuthRejected/HttpException to control
    // the HTTP status. A plain Error is NOT an HttpException, so it surfaces as
    // a 500 (after the token is revoked). This documents that contract.
    it('a plain Error thrown by a hook is not an HttpException (becomes a 500)', async () => {
      const hooks: AuthLifecycleHooks = {
        afterLogin: () => {
          throw new Error('boom');
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      await seedUser(env);
      const err = await env.controllers.auth
        .login({ email: 'a@b.c', password: 'secret' }, reqFor('driver'))
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      // No getStatus() => Nest maps it to 500 (not a controlled status).
      expect(typeof (err as any).getStatus).toBe('undefined');
      // Token was still revoked on the way out.
      expect(env.client._data.revokedToken).toHaveLength(1);
    });

    it('a group without a hooks class works (no-op)', async () => {
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, models: '*' } },
      });
      await seedUser(env);
      const res = await env.controllers.auth.login(
        { email: 'a@b.c', password: 'secret' },
        reqFor('driver'),
      );
      expect(res.token).toBeTruthy();
    });
  });

  describe('afterLogout / afterPasswordRecover / afterPasswordReset', () => {
    it('afterLogout fires with the user + group', async () => {
      let seen: any = null;
      const hooks: AuthLifecycleHooks = { afterLogout: (c) => void (seen = c) };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      const res = await env.controllers.auth.logout(reqFor('driver', { user: { id: 9 } }));
      expect(res).toEqual({ success: true });
      expect(seen.routeGroup).toBe('driver');
      expect(seen.user.id).toBe(9);
    });

    it('afterPasswordRecover fires with the resolved user', async () => {
      let seen: any = null;
      const hooks: AuthLifecycleHooks = { afterPasswordRecover: (c) => void (seen = c) };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.user = [{ id: 1, email: 'a@b.c', password: 'x' }];
      await env.controllers.auth.recover({ email: 'a@b.c' }, reqFor('driver'));
      expect(seen.routeGroup).toBe('driver');
      expect(seen.user.email).toBe('a@b.c');
    });

    // FIX 6: a rejecting afterPasswordRecover must NOT change the uniform
    // recovery response (no account-enumeration oracle). The hook still runs
    // (side effects), but its rejection is swallowed.
    it('a rejecting afterPasswordRecover still returns the uniform success (no enum oracle)', async () => {
      let fired = false;
      const hooks: AuthLifecycleHooks = {
        afterPasswordRecover: () => {
          fired = true;
          throw new RhinoAuthRejected('blocked', 403);
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.user = [{ id: 1, email: 'a@b.c', password: 'x' }];
      // Existing email
      await expect(
        env.controllers.auth.recover({ email: 'a@b.c' }, reqFor('driver')),
      ).resolves.toEqual({ success: true });
      expect(fired).toBe(true);
      // Unknown email — same uniform response, hook rejection still swallowed.
      await expect(
        env.controllers.auth.recover({ email: 'nobody@x.com' }, reqFor('driver')),
      ).resolves.toEqual({ success: true });
    });

    it('a rejecting afterPasswordReset DOES propagate (reject semantics kept)', async () => {
      const hooks: AuthLifecycleHooks = {
        afterPasswordReset: () => {
          throw new RhinoAuthRejected('nope', 403);
        },
      };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.user = [
        { id: 1, email: 'a@b.c', password: await env.auth.hashPassword('old') },
      ];
      await env.controllers.auth.recover({ email: 'a@b.c' }, reqFor('driver'));
      const token = env.client._data.passwordResetToken[0].token;
      await expect(
        env.controllers.auth.reset({ email: 'a@b.c', token, password: 'new' }, reqFor('driver')),
      ).rejects.toThrow(RhinoAuthRejected);
    });

    it('afterPasswordReset fires after a successful reset', async () => {
      let fired = false;
      const hooks: AuthLifecycleHooks = { afterPasswordReset: () => void (fired = true) };
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.user = [
        { id: 1, email: 'a@b.c', password: await env.auth.hashPassword('old') },
      ];
      await env.controllers.auth.recover({ email: 'a@b.c' }, reqFor('driver'));
      const token = env.client._data.passwordResetToken[0].token;
      await env.controllers.auth.reset(
        { email: 'a@b.c', token, password: 'new' },
        reqFor('driver'),
      );
      expect(fired).toBe(true);
    });
  });

  describe('afterRegister', () => {
    it('fires with the invitation group and revokes token on reject', async () => {
      let seen: any = null;
      const hooks: AuthLifecycleHooks = {
        afterRegister: (c) => {
          seen = c;
          throw new RhinoAuthRejected('not allowed', 403);
        },
      };
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.organizationInvitation = [
        {
          id: 1,
          token: 'invite-token',
          email: 'a@b.c',
          status: 'pending',
          organizationId: 5,
          roleId: 9,
          routeGroup: 'driver',
          organization: { id: 5, slug: 'acme' },
          role: { id: 9, slug: 'driver' },
          expiresAt: future,
        },
      ];
      await expect(
        env.controllers.auth.register(
          { email: 'a@b.c', password: 'hunter2', invitationToken: 'invite-token' },
          reqFor('driver'),
        ),
      ).rejects.toThrow(RhinoAuthRejected);
      expect(seen.routeGroup).toBe('driver');
      expect(env.client._data.revokedToken).toHaveLength(1);
    });

    it('register succeeds and fires afterRegister when not rejecting', async () => {
      let fired = false;
      const hooks: AuthLifecycleHooks = { afterRegister: () => void (fired = true) };
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const env = buildEnv({
        models: {},
        auth: { jwtSecret: 't' },
        routeGroups: { driver: { prefix: 'driver', auth: true, hooks, models: '*' } },
      });
      env.client._data.organizationInvitation = [
        {
          id: 1,
          token: 'invite-token',
          email: 'a@b.c',
          status: 'pending',
          organizationId: 5,
          roleId: 9,
          routeGroup: 'driver',
          organization: { id: 5, slug: 'acme' },
          role: { id: 9, slug: 'driver' },
          expiresAt: future,
        },
      ];
      const res = await env.controllers.auth.register(
        { email: 'a@b.c', password: 'hunter2', invitationToken: 'invite-token' },
        reqFor('driver'),
      );
      expect(res.token).toBeTruthy();
      expect(fired).toBe(true);
      // Membership row carries the invitation's group.
      expect(env.client._data.userRole[0].routeGroup).toBe('driver');
    });
  });
});
