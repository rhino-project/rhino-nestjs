import { buildEnv } from '../helpers/make-controller';
import { HttpException } from '@nestjs/common';
import { RhinoException } from '../../src/errors/rhino-exception';
import type { RhinoConfig } from '../../src/interfaces/rhino-config.interface';

/**
 * Invitations carry the group (design §8): invite stores route_group; accept
 * populates the membership with it; non-tenant invites store a NULL org; the
 * public group cannot be invited into; with enforcement on the inviter must be
 * a member of the group.
 */
describe('Group-aware invitations', () => {
  function inviter(perms = ['invitations.*'], rows: any[] = []) {
    return { id: 1, userRoles: [{ organizationId: 1, permissions: perms }, ...rows] };
  }
  function ctx(req: any) {
    return { user: inviter(), organization: { id: 1, slug: 'acme' }, ...req };
  }

  const tenantCfg: Partial<RhinoConfig> = {
    multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
    routeGroups: {
      tenant: { prefix: 'tenant', tenant: true, models: '*' },
      driver: { prefix: 'driver', tenant: false, models: '*' },
      public: { prefix: 'public', skipAuth: true, models: '*' },
    },
  };

  it('store records route_group from the request group', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await env.controllers.invitation.store(
      ctx({ __routeGroup: 'tenant' }) as any,
      { email: 'x@y.com', roleId: 1 },
    );
    const inv = env.client._data.organizationInvitation[0];
    expect(inv.routeGroup).toBe('tenant');
    expect(inv.organizationId).toBe(1);
  });

  // FIX 7 (NIT): the wildcard path — no body.routeGroup and no resolved group →
  // the invite stores route_group = null (a membership wildcard, Decision 9.B).
  it('store records route_group = null when no group is resolved (wildcard)', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await env.controllers.invitation.store(
      ctx({}) as any, // no __routeGroup, no body.routeGroup
      { email: 'x@y.com', roleId: 1 },
    );
    const inv = env.client._data.organizationInvitation[0];
    expect(inv.routeGroup).toBeNull();
    expect(inv.organizationId).toBe(1);
  });

  it('store records an explicit body.routeGroup', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await env.controllers.invitation.store(
      ctx({}) as any,
      { email: 'x@y.com', roleId: 1, routeGroup: 'tenant' },
    );
    expect(env.client._data.organizationInvitation[0].routeGroup).toBe('tenant');
  });

  it('non-tenant group invite stores a NULL org (enforcement on)', async () => {
    const env = buildEnv({
      models: {},
      auth: { enforceGroupMembership: true },
      ...tenantCfg,
    } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await env.controllers.invitation.store(
      // inviter is a NULL-wildcard member, so allowed to invite into driver
      { user: inviter(['invitations.*'], [{ routeGroup: null, permissions: [] }]), organization: { id: 1 }, __routeGroup: 'driver' } as any,
      { email: 'd@y.com', roleId: 1 },
    );
    const inv = env.client._data.organizationInvitation[0];
    expect(inv.routeGroup).toBe('driver');
    expect(inv.organizationId).toBeNull();
  });

  // FIX 4: a client-supplied routeGroup that is not a configured group (and not
  // `public`) is rejected with 422, regardless of enforcement, so a forged
  // group can never seed a dormant unaudited grant.
  it('rejects a forged/unknown body.routeGroup with 422 (enforcement off)', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    const err = await env.controllers.invitation
      .store(ctx({}) as any, { email: 'x@y.com', roleId: 1, routeGroup: 'ghost' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RhinoException);
    expect((err as HttpException).getStatus()).toBe(422);
    expect((err as RhinoException).code).toBe('VALIDATION_FAILED');
    // Nothing was created.
    expect(env.client._data.organizationInvitation ?? []).toHaveLength(0);
  });

  it('rejects a forged/unknown body.routeGroup with 422 (enforcement on)', async () => {
    const env = buildEnv({
      models: {},
      auth: { enforceGroupMembership: true },
      ...tenantCfg,
    } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    const err = await env.controllers.invitation
      .store(
        { user: inviter(['invitations.*'], [{ routeGroup: null, permissions: [] }]), organization: { id: 1 } } as any,
        { email: 'x@y.com', roleId: 1, routeGroup: 'ghost' },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(RhinoException);
    expect((err as HttpException).getStatus()).toBe(422);
  });

  it('cannot invite into the public group', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await expect(
      env.controllers.invitation.store(
        ctx({}) as any,
        { email: 'x@y.com', roleId: 1, routeGroup: 'public' },
      ),
    ).rejects.toThrow(/public/i);
  });

  it('with enforcement on, inviter must be a member of the group (403, not 400)', async () => {
    const env = buildEnv({
      models: {},
      auth: { enforceGroupMembership: true },
      ...tenantCfg,
    } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    // inviter is a concrete member of `admin` only (not the wildcard) → denied
    // for `driver`. Top-level permission lets it past the coarse permission gate.
    const nonMember = {
      id: 1,
      permissions: ['invitations.*'],
      userRoles: [{ routeGroup: 'admin', organizationId: null, permissions: [] }],
    };
    // Coarse membership denial is a 403 for parity with Laravel/Rails
    // (Decision 9.C), NOT a 400.
    const err = await env.controllers.invitation
      .store(
        // non-tenant group → no org context needed; perms resolve top-level
        { user: nonMember, __routeGroup: 'driver' } as any,
        { email: 'x@y.com', roleId: 1 },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(RhinoException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as RhinoException).code).toBe('MEMBERSHIP_DENIED');
  });

  it('with enforcement on, a member inviter can invite into the group', async () => {
    const env = buildEnv({
      models: {},
      auth: { enforceGroupMembership: true },
      ...tenantCfg,
    } as RhinoConfig);
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    const member = {
      id: 1,
      permissions: ['invitations.*'],
      userRoles: [{ routeGroup: 'driver', organizationId: null, permissions: [] }],
    };
    await env.controllers.invitation.store(
      { user: member, __routeGroup: 'driver' } as any,
      { email: 'x@y.com', roleId: 1 },
    );
    expect(env.client._data.organizationInvitation[0].routeGroup).toBe('driver');
  });

  it('accept populates the membership with the invitation group', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    const future = new Date();
    future.setDate(future.getDate() + 5);
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'tok',
        email: 'x@y.com',
        status: 'pending',
        organizationId: 1,
        roleId: 9,
        routeGroup: 'tenant',
        organization: { id: 1, slug: 'acme' },
        role: { id: 9, slug: 'admin' },
        expiresAt: future,
      },
    ];
    const res: any = await env.controllers.invitation.accept(
      { token: 'tok' },
      { user: { id: 42 } } as any,
    );
    expect(res.accepted).toBe(true);
    expect(res.routeGroup).toBe('tenant');
    expect(env.client._data.userRole[0]).toMatchObject({
      userId: 42,
      organizationId: 1,
      roleId: 9,
      routeGroup: 'tenant',
    });
  });

  it('accept of a non-tenant invite creates a NULL-org membership', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    const future = new Date();
    future.setDate(future.getDate() + 5);
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'tok',
        email: 'd@y.com',
        status: 'pending',
        organizationId: null,
        roleId: 9,
        routeGroup: 'driver',
        organization: null,
        role: { id: 9, slug: 'driver' },
        expiresAt: future,
      },
    ];
    await env.controllers.invitation.accept({ token: 'tok' }, { user: { id: 7 } } as any);
    expect(env.client._data.userRole[0]).toMatchObject({
      userId: 7,
      organizationId: null,
      routeGroup: 'driver',
    });
  });

  it('accept returns the group for an unauthenticated invitee', async () => {
    const env = buildEnv({ models: {}, ...tenantCfg } as RhinoConfig);
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'tok',
        email: 'x@y.com',
        status: 'pending',
        organizationId: 1,
        roleId: 9,
        routeGroup: 'tenant',
        organization: { id: 1 },
        role: { id: 9 },
        expiresAt: new Date(Date.now() + 60_000),
      },
    ];
    const res: any = await env.controllers.invitation.accept(
      { token: 'tok' },
      { user: null } as any,
    );
    expect(res.requiresRegistration).toBe(true);
    expect(res.routeGroup).toBe('tenant');
  });
});
