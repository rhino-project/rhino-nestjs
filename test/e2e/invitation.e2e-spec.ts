import { buildEnv } from '../helpers/make-controller';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('InvitationController (integration)', () => {
  function ctx(org = 1, perms = ['invitations.*']) {
    return {
      user: { id: 1, userRoles: [{ organizationId: org, permissions: perms }] },
      organization: { id: org, slug: 'acme' },
    };
  }

  it('denies when user lacks invitations permission', async () => {
    const env = buildEnv({ models: {} });
    await expect(
      env.controllers.invitation.index(ctx(1, []) as any),
    ).rejects.toThrow();
  });

  it('creates an invitation and lists it', async () => {
    const env = buildEnv({ models: {} });
    env.client._data.role = [{ id: 1, slug: 'admin' }];
    await env.controllers.invitation.store(
      ctx() as any,
      { email: 'x@y.com', roleId: 1 },
    );
    const res: any = await env.controllers.invitation.index(ctx() as any);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].email).toBe('x@y.com');
    expect(res.data[0].status).toBe('pending');
  });

  it('requires email and roleId', async () => {
    const env = buildEnv({ models: {} });
    await expect(
      env.controllers.invitation.store(ctx() as any, {} as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('accept: returns requiresRegistration for unauthenticated user', async () => {
    const env = buildEnv({ models: {} });
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'abc',
        email: 'x@y.com',
        status: 'pending',
        organizationId: 1,
        roleId: 1,
        expiresAt: new Date(Date.now() + 60_000),
        organization: { id: 1, slug: 'acme' },
        role: { id: 1, slug: 'admin' },
      },
    ];
    const res: any = await env.controllers.invitation.accept(
      { token: 'abc' },
      { user: null } as any,
    );
    expect(res.requiresRegistration).toBe(true);
    expect(res.email).toBe('x@y.com');
  });

  it('accept: expired invitation fails', async () => {
    const env = buildEnv({ models: {} });
    env.client._data.organizationInvitation = [
      {
        id: 1,
        token: 'exp',
        email: 'x@y.com',
        status: 'pending',
        organizationId: 1,
        roleId: 1,
        expiresAt: new Date(Date.now() - 60_000),
        organization: { id: 1, slug: 'acme' },
        role: { id: 1, slug: 'admin' },
      },
    ];
    await expect(
      env.controllers.invitation.accept({ token: 'exp' }, { user: null } as any),
    ).rejects.toThrow(/expired/);
  });

  it('accept: unknown token 404s', async () => {
    const env = buildEnv({ models: {} });
    await expect(
      env.controllers.invitation.accept({ token: 'nope' }, { user: null } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('cancel marks invitation as cancelled', async () => {
    const env = buildEnv({ models: {} });
    env.client._data.organizationInvitation = [
      { id: 1, status: 'pending', organizationId: 1, expiresAt: new Date() },
    ];
    await env.controllers.invitation.cancel(ctx() as any, '1');
    expect(env.client._data.organizationInvitation[0].status).toBe('cancelled');
  });
});
