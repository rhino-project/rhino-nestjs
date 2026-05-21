import { buildEnv } from '../helpers/make-controller';
import { BadRequestException } from '@nestjs/common';
import { RhinoException } from '../../src/errors/rhino-exception';

describe('AuthController (integration)', () => {
  it('login returns a token and organization_slug', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 'test' } });
    const password = await env.auth.hashPassword('secret');
    env.client._data.user = [
      {
        id: 1,
        email: 'a@b.c',
        password,
        userRoles: [{ organization: { slug: 'acme' }, role: { slug: 'admin' } }],
      },
    ];
    const res = await env.controllers.auth.login({ email: 'a@b.c', password: 'secret' });
    expect(res.token).toBeTruthy();
    expect(res.organization_slug).toBe('acme');
  });

  it('login rejects bad credentials', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 'test' } });
    env.client._data.user = [
      { id: 1, email: 'a@b.c', password: await env.auth.hashPassword('pw') },
    ];
    await expect(
      env.controllers.auth.login({ email: 'a@b.c', password: 'wrong' }),
    ).rejects.toThrow(RhinoException);
  });

  it('login requires both email and password', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    await expect(env.controllers.auth.login({} as any)).rejects.toThrow(BadRequestException);
  });

  it('logout returns success (stateless JWT)', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    const res = await env.controllers.auth.logout({ user: { id: 1 } } as any);
    expect(res).toEqual({ success: true });
  });

  it('recover returns success even for unknown emails (no info leak)', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    const res = await env.controllers.auth.recover({ email: 'unknown@x.com' });
    expect(res).toEqual({ success: true });
  });

  it('recover requires email', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    await expect(env.controllers.auth.recover({} as any)).rejects.toThrow(BadRequestException);
  });

  it('reset requires all fields', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    await expect(
      env.controllers.auth.reset({ email: 'a' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('reset rejects invalid token', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    env.client._data.user = [
      { id: 1, email: 'a@b.c', password: await env.auth.hashPassword('old') },
    ];
    // No token row in passwordResetToken
    await expect(
      env.controllers.auth.reset({ email: 'a@b.c', token: 'bogus', password: 'new' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('register requires email + password + invitationToken', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    await expect(
      env.controllers.auth.register({ email: 'a@b.c' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('register creates a user, accepts invitation and returns a token', async () => {
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
    const res = await env.controllers.auth.register({
      email: 'a@b.c',
      password: 'hunter2',
      invitationToken: 'invite-token',
      name: 'Alice',
    });
    expect(res.token).toBeTruthy();
    expect(res.user).toMatchObject({ email: 'a@b.c', name: 'Alice' });
    expect((res as any).accepted).toBe(true);
    // UserRole row was written linking user ↔ org
    expect(env.client._data.userRole).toHaveLength(1);
    expect(env.client._data.userRole[0]).toMatchObject({
      organizationId: 5,
      roleId: 9,
    });
  });

  it('password reset flow', async () => {
    const env = buildEnv({ models: {}, auth: { jwtSecret: 't' } });
    env.client._data.user = [
      { id: 1, email: 'a@b.c', password: await env.auth.hashPassword('old') },
    ];
    await env.controllers.auth.recover({ email: 'a@b.c' });
    const token = env.client._data.passwordResetToken[0].token;
    await env.controllers.auth.reset({ email: 'a@b.c', token, password: 'new' });
    const updated = env.client._data.user[0];
    expect(await env.auth.checkPassword('new', updated.password)).toBe(true);
  });
});
