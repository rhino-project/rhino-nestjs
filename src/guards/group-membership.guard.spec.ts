import { GroupMembershipGuard } from './group-membership.guard';
import { MembershipService } from '../services/membership.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';
import { userHasPermission } from '../utils/permission-matcher';

function makeGuard(cfg: Partial<RhinoConfig>) {
  const config = new RhinoConfigService(
    normalizeConfig({ models: {}, ...cfg } as RhinoConfig),
  );
  const membership = new MembershipService(config);
  return new GroupMembershipGuard(config, membership);
}

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('GroupMembershipGuard', () => {
  describe('flag OFF (default)', () => {
    it('is a pure no-op — allows any request without inspecting it', () => {
      const guard = makeGuard({});
      const req: any = {}; // no user, no group, nothing
      expect(guard.canActivate(ctx(req))).toBe(true);
      expect(req.user).toBeUndefined();
    });
  });

  describe('flag ON', () => {
    const onCfg = { auth: { enforceGroupMembership: true } };

    it('allows when a membership row matches the group', () => {
      const guard = makeGuard(onCfg);
      const req: any = {
        __routeGroup: 'driver',
        user: { id: 1, userRoles: [{ routeGroup: 'driver', permissions: ['trips.*'] }] },
      };
      expect(guard.canActivate(ctx(req))).toBe(true);
    });

    it('denies with 403 when no row matches', () => {
      const guard = makeGuard(onCfg);
      const req: any = {
        __routeGroup: 'driver',
        user: { id: 1, userRoles: [{ routeGroup: 'admin', permissions: [] }] },
      };
      try {
        guard.canActivate(ctx(req));
        fail('expected membership denial');
      } catch (e) {
        expect(e).toBeInstanceOf(RhinoException);
        expect((e as RhinoException).getStatus()).toBe(403);
      }
    });

    it('NULL membership row is a wildcard (allows any group)', () => {
      const guard = makeGuard(onCfg);
      const req: any = {
        __routeGroup: 'driver',
        user: { id: 1, userRoles: [{ routeGroup: null, permissions: [] }] },
      };
      expect(guard.canActivate(ctx(req))).toBe(true);
    });

    it('public group bypasses the check', () => {
      const guard = makeGuard(onCfg);
      const req: any = {
        __routeGroup: 'public',
        user: { id: 1, userRoles: [] },
      };
      expect(guard.canActivate(ctx(req))).toBe(true);
    });

    it('skipAuth bypasses the check', () => {
      const guard = makeGuard(onCfg);
      const req: any = { __skipAuth: true };
      expect(guard.canActivate(ctx(req))).toBe(true);
    });

    it('switches the permission source to the matched row only', () => {
      const guard = makeGuard(onCfg);
      const user = {
        id: 1,
        userRoles: [
          { routeGroup: 'driver', organizationId: null, permissions: ['trips.index'] },
          { routeGroup: 'admin', organizationId: null, permissions: ['users.*'] },
        ],
      };
      const req: any = { __routeGroup: 'driver', user };
      guard.canActivate(ctx(req));
      // After enforcement, only the driver row's permissions apply.
      expect(userHasPermission(user, 'trips.index')).toBe(true);
      expect(userHasPermission(user, 'users.destroy')).toBe(false);
    });

    // FIX 3: an enforced request on the resolved default group must honor the
    // route_group dimension. A user scoped ONLY to another group must be denied
    // (403) — previously the default group resolved to a null __routeGroup,
    // which matched ANY membership row and let this user through.
    it('denies (403) an enforced request on the default group for a user scoped to another group', () => {
      const guard = makeGuard({
        auth: { enforceGroupMembership: true },
        routeGroups: { default: { models: '*' }, admin: { prefix: 'admin', models: '*' } },
      });
      const req: any = {
        __routeGroup: 'default', // resolved by RouteGroupMiddleware (FIX 3)
        user: { id: 1, userRoles: [{ routeGroup: 'admin', organizationId: null, permissions: [] }] },
      };
      try {
        guard.canActivate(ctx(req));
        fail('expected membership denial');
      } catch (e) {
        expect(e).toBeInstanceOf(RhinoException);
        expect((e as RhinoException).getStatus()).toBe(403);
      }
    });

    it('allows an enforced request on the default group for a member of that group', () => {
      const guard = makeGuard({
        auth: { enforceGroupMembership: true },
        routeGroups: { default: { models: '*' }, admin: { prefix: 'admin', models: '*' } },
      });
      const req: any = {
        __routeGroup: 'default',
        user: { id: 1, userRoles: [{ routeGroup: 'default', organizationId: null, permissions: [] }] },
      };
      expect(guard.canActivate(ctx(req))).toBe(true);
    });

    it('tenant group also requires the resolved org to match', () => {
      const guard = makeGuard({
        auth: { enforceGroupMembership: true },
        multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
        routeGroups: { tenant: { tenant: true, models: '*' } },
      });
      const user = {
        id: 1,
        userRoles: [{ routeGroup: 'tenant', organizationId: 2, permissions: [] }],
      };
      const req: any = { __routeGroup: 'tenant', user, organization: { id: 1 } };
      expect(() => guard.canActivate(ctx(req))).toThrow(RhinoException);
    });
  });
});
