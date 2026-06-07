import { AuthController } from './auth.controller';
import { MembershipService } from '../services/membership.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

/**
 * Login-time group-membership enforcement (parity with the resource-layer
 * GroupMembershipGuard and the Laravel/Rails AuthControllers): when
 * `auth.enforceGroupMembership` is ON, /auth/login must reject a non-member with
 * 403 and never return a token — rather than authenticating and only blocking on
 * the first resource request.
 */
describe('AuthController login — group membership enforcement', () => {
  const baseCfg = (enforce: boolean): RhinoConfig =>
    ({
      models: { posts: { model: 'post' } },
      multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
      routeGroups: {
        tenant: { prefix: ':organization', tenant: true, models: '*' },
        public: { prefix: 'public', skipAuth: true, models: '*' },
      },
      auth: { enforceGroupMembership: enforce },
    }) as RhinoConfig;

  function build(enforce: boolean, loginUser: any) {
    const config = new RhinoConfigService(normalizeConfig(baseCfg(enforce)));
    const membership = new MembershipService(config);
    const authService: any = {
      login: jest.fn(async () => ({
        token: 'tok-123',
        organizationSlug: 'acme',
        user: loginUser,
      })),
      revokeToken: jest.fn(async () => undefined),
    };
    // hooks omitted (no-op); invitationService/prisma unused by login.
    const controller = new AuthController(
      authService,
      {} as any,
      {} as any,
      config,
      undefined,
      membership,
    );
    return { controller, authService };
  }

  const tenantReq = (org = { id: 1, slug: 'acme' }) => ({
    __routeGroup: 'tenant',
    organization: org,
  });

  it('ON: non-member → 403, token revoked, not returned', async () => {
    const { controller, authService } = build(true, { id: 42, userRoles: [] });
    await expect(
      controller.login({ email: 'a@b.com', password: 'x' }, tenantReq()),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
    expect(authService.revokeToken).toHaveBeenCalledWith('tok-123');
  });

  it('ON: non-member → the thrown error is a 403 RhinoException', async () => {
    const { controller } = build(true, { id: 42, userRoles: [] });
    try {
      await controller.login({ email: 'a@b.com', password: 'x' }, tenantReq());
      fail('expected 403');
    } catch (e) {
      expect(e).toBeInstanceOf(RhinoException);
      expect((e as RhinoException).getStatus()).toBe(403);
    }
  });

  it('ON: member of the group + org → token returned, not revoked', async () => {
    const { controller, authService } = build(true, {
      id: 42,
      userRoles: [{ routeGroup: 'tenant', organizationId: 1, permissions: ['posts.*'] }],
    });
    const res = await controller.login(
      { email: 'a@b.com', password: 'x' },
      tenantReq(),
    );
    expect(res).toEqual({ token: 'tok-123', organization_slug: 'acme' });
    expect(authService.revokeToken).not.toHaveBeenCalled();
  });

  it('ON: member of the org but WRONG group → 403', async () => {
    const { controller } = build(true, {
      id: 42,
      userRoles: [{ routeGroup: 'admin', organizationId: 1, permissions: [] }],
    });
    await expect(
      controller.login({ email: 'a@b.com', password: 'x' }, tenantReq()),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
  });

  it('ON: __skipAuth (set on auth entrypoints to bypass JWT) does NOT bypass membership → 403', async () => {
    // Consumers (e.g. the hybrid example) set req.__skipAuth on /auth/login so
    // the JWT guard is skipped (no token yet). That must NOT disable the login
    // membership gate — a non-member is still rejected.
    const { controller } = build(true, { id: 42, userRoles: [] });
    await expect(
      controller.login({ email: 'a@b.com', password: 'x' }, {
        ...tenantReq(),
        __skipAuth: true,
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
  });

  it('ON: public group never enforces membership → token returned', async () => {
    const { controller, authService } = build(true, { id: 42, userRoles: [] });
    const res = await controller.login({ email: 'a@b.com', password: 'x' }, {
      __routeGroup: 'public',
    });
    expect(res).toEqual({ token: 'tok-123', organization_slug: 'acme' });
    expect(authService.revokeToken).not.toHaveBeenCalled();
  });

  it('OFF (default): non-member still authenticates (byte-for-byte unchanged)', async () => {
    const { controller, authService } = build(false, { id: 42, userRoles: [] });
    const res = await controller.login(
      { email: 'a@b.com', password: 'x' },
      tenantReq(),
    );
    expect(res).toEqual({ token: 'tok-123', organization_slug: 'acme' });
    expect(authService.revokeToken).not.toHaveBeenCalled();
  });
});
