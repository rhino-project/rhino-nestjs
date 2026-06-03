import { buildEnv } from '../helpers/make-controller';
import { RhinoConfigService, normalizeConfig } from '../../src/rhino.config';
import { MembershipService } from '../../src/services/membership.service';
import { userHasPermission } from '../../src/utils/permission-matcher';
import type { RhinoConfig } from '../../src/interfaces/rhino-config.interface';

/**
 * Back-compat guards (design §10): with `enforceGroupMembership` off and no
 * `auth`/`hooks` configured, every code path behaves exactly as before.
 */
describe('Group-auth back-compat (flags off)', () => {
  it('enforceGroupMembership defaults to false', () => {
    const config = new RhinoConfigService(normalizeConfig({ models: {} } as RhinoConfig));
    expect(config.enforceGroupMembership()).toBe(false);
    expect(config.authConfig().enforceGroupMembership).toBe(false);
  });

  it('MembershipService.enabled() is false by default', () => {
    const config = new RhinoConfigService(normalizeConfig({ models: {} } as RhinoConfig));
    expect(new MembershipService(config).enabled()).toBe(false);
  });

  it('permission resolution is unchanged when no membership permissions attached', () => {
    // The legacy org-presence heuristic still applies (no __membershipPermissions).
    const user = { id: 1, userRoles: [{ organizationId: 1, permissions: ['posts.index'] }] };
    expect(userHasPermission(user, 'posts.index', { id: 1 })).toBe(true);
    expect(userHasPermission(user, 'posts.index', { id: 2 })).toBe(false);
  });

  it('login behaves exactly as before (token + organization_slug) with no group/hooks', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    env.client._data.user = [
      {
        id: 1,
        email: 'a@b.c',
        password: await env.auth.hashPassword('secret'),
        userRoles: [{ organization: { slug: 'acme' }, role: { slug: 'admin' } }],
      },
    ];
    // No req argument at all — must still work (back-compat call shape).
    const res = await env.controllers.auth.login({ email: 'a@b.c', password: 'secret' });
    expect(res).toEqual({ token: expect.any(String), organization_slug: 'acme' });
    expect(env.client._data.revokedToken).toBeUndefined();
  });

  it('register behaves exactly as before with no group/hooks', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    const future = new Date();
    future.setDate(future.getDate() + 5);
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'invite-token',
        email: 'a@b.c',
        status: 'pending',
        organizationId: 5,
        roleId: 9,
        organization: { id: 5, slug: 'acme' },
        role: { id: 9, slug: 'admin' },
        expiresAt: future,
      },
    ];
    const res: any = await env.controllers.auth.register({
      email: 'a@b.c',
      password: 'hunter2',
      invitationToken: 'invite-token',
      name: 'Alice',
    });
    expect(res.token).toBeTruthy();
    expect(res.accepted).toBe(true);
    // Membership row created with NULL route_group (wildcard) and the org.
    expect(env.client._data.userRole[0]).toMatchObject({
      organizationId: 5,
      roleId: 9,
      routeGroup: null,
    });
  });

  it('invitation store still requires an org on the legacy path', async () => {
    const env = buildEnv({ models: {} });
    await expect(
      env.controllers.invitation.store(
        // top-level permission so the permission gate passes without org context
        { user: { id: 1, permissions: ['invitations.*'] } } as any,
        { email: 'x@y.com', roleId: 1 },
      ),
    ).rejects.toThrow(/Organization context required/);
  });
});

/**
 * Cross-group / cross-tenant isolation (design §10): a member of group A / org A
 * cannot use group B or org B once enforcement is on.
 */
describe('Cross-group / cross-tenant isolation (enforcement on)', () => {
  function svc() {
    const config = new RhinoConfigService(
      normalizeConfig({
        models: {},
        auth: { enforceGroupMembership: true },
        multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
        routeGroups: {
          groupA: { prefix: 'a', tenant: true, models: '*' },
          groupB: { prefix: 'b', tenant: true, models: '*' },
        },
      } as RhinoConfig),
    );
    return new MembershipService(config);
  }

  it('group A member is denied group B', () => {
    const s = svc();
    const user = { id: 1, userRoles: [{ routeGroup: 'groupA', organizationId: 1, permissions: [] }] };
    expect(s.isMember(user, 'groupA', { id: 1 }, true)).toBe(true);
    expect(s.isMember(user, 'groupB', { id: 1 }, true)).toBe(false);
  });

  it('org A member is denied org B in the same group', () => {
    const s = svc();
    const user = { id: 1, userRoles: [{ routeGroup: 'groupA', organizationId: 1, permissions: [] }] };
    expect(s.isMember(user, 'groupA', { id: 1 }, true)).toBe(true);
    expect(s.isMember(user, 'groupA', { id: 2 }, true)).toBe(false);
  });
});
