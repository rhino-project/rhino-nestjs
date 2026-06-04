import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';

function setup(userDelegate: any, auth: any = { jwtSecret: 'test-secret' }) {
  const prisma = new PrismaService({ user: userDelegate });
  const config = new RhinoConfigService(normalizeConfig({ models: {}, auth }));
  return new AuthService(prisma, config);
}

describe('AuthService', () => {
  it('hashes and verifies passwords', async () => {
    const svc = setup({ findFirst: jest.fn() });
    const h = await svc.hashPassword('secret');
    expect(h).not.toBe('secret');
    expect(await svc.checkPassword('secret', h)).toBe(true);
    expect(await svc.checkPassword('nope', h)).toBe(false);
  });

  it('signs and verifies JWT tokens', () => {
    const svc = setup({ findFirst: jest.fn() });
    const token = svc.signToken({ sub: 1, email: 'a@b.c' });
    expect(svc.verifyToken(token).sub).toBe(1);
  });

  it('throws on invalid token', () => {
    const svc = setup({ findFirst: jest.fn() });
    expect(() => svc.verifyToken('invalid')).toThrow(RhinoException);
  });

  it('login returns token, user, orgSlug', async () => {
    const user = {
      id: 1,
      email: 'a@b.c',
      password: await (await setup({ findFirst: jest.fn() })).hashPassword('p'),
      userRoles: [{ organization: { slug: 'acme' }, role: { slug: 'admin' } }],
    };
    const svc = setup({ findFirst: jest.fn().mockResolvedValue(user) });
    const res = await svc.login('a@b.c', 'p');
    expect(res.token).toBeTruthy();
    expect(res.organizationSlug).toBe('acme');
  });

  it('login rejects with unauthorized on bad password', async () => {
    const u = await (await setup({ findFirst: jest.fn() })).hashPassword('ok');
    const svc = setup({ findFirst: jest.fn().mockResolvedValue({ id: 1, email: 'x', password: u }) });
    await expect(svc.login('x', 'nope')).rejects.toThrow(RhinoException);
  });

  it('login rejects when user missing', async () => {
    const svc = setup({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(svc.login('x', 'nope')).rejects.toThrow(RhinoException);
  });

  describe('org-less (single-tenant) login', () => {
    function setupOrgless(userDelegate: any) {
      const prisma = new PrismaService({ user: userDelegate });
      // No multiTenant block at all → multiTenantEnabled() is false.
      const config = new RhinoConfigService(
        normalizeConfig({ models: {}, auth: { jwtSecret: 'test-secret' } }),
      );
      return { svc: new AuthService(prisma, config), config };
    }

    it('logs in a user whose User model has no userRoles relation (no org include)', async () => {
      const hashed = await (await setup({ findFirst: jest.fn() })).hashPassword('p');
      // Plain delegate: succeeds without an `include` and would NOT support one.
      const findFirst = jest.fn(async (args: any) => {
        if (args?.include) {
          // A single-tenant User model has no userRoles relation: Prisma rejects.
          throw new Error('Unknown field `userRoles` for include statement');
        }
        return { id: 7, email: 'solo@example.com', password: hashed };
      });
      const { svc } = setupOrgless({ findFirst });
      const res = await svc.login('solo@example.com', 'p');
      expect(res.token).toBeTruthy();
      expect(res.organizationSlug).toBeUndefined();
      // When multi-tenancy is off we never even attempt the org include.
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls[0][0]).not.toHaveProperty('include');
    });

    it('falls back to a plain lookup when the org include throws under multi-tenancy', async () => {
      const hashed = await (await setup({ findFirst: jest.fn() })).hashPassword('p');
      const findFirst = jest.fn(async (args: any) => {
        if (args?.include) throw new Error('relation missing');
        return { id: 8, email: 'fallback@example.com', password: hashed };
      });
      const prisma = new PrismaService({ user: { findFirst } });
      const config = new RhinoConfigService(
        normalizeConfig({
          models: {},
          auth: { jwtSecret: 'test-secret' },
          multiTenant: { enabled: true, organizationModel: 'organization' },
        }),
      );
      const svc = new AuthService(prisma, config);
      const res = await svc.login('fallback@example.com', 'p');
      expect(res.token).toBeTruthy();
      // First attempt (with include) failed, second (plain) succeeded.
      expect(findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('token revocation', () => {
    it('revokeToken records the token in the denylist when available', async () => {
      const created: any[] = [];
      const prisma = new PrismaService({
        user: { findFirst: jest.fn() },
        revokedToken: {
          create: jest.fn(async (args: any) => {
            created.push(args.data);
            return args.data;
          }),
          findFirst: jest.fn(async (args: any) =>
            created.find((r) => r.token === args.where.token) ?? null,
          ),
        },
      } as any);
      const config = new RhinoConfigService(normalizeConfig({ models: {}, auth: { jwtSecret: 't' } }));
      const svc = new AuthService(prisma, config);
      await svc.revokeToken('abc');
      expect(created).toHaveLength(1);
      expect(await svc.isTokenRevoked('abc')).toBe(true);
      expect(await svc.isTokenRevoked('other')).toBe(false);
    });

    it('revokeToken logs a WARNING (not silent) when no denylist model exists', async () => {
      const svc = setup({ findFirst: jest.fn() });
      const warn = jest
        .spyOn((svc as any).logger, 'warn')
        .mockImplementation(() => undefined);
      try {
        await expect(svc.revokeToken('abc')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/RevokedToken/);
        expect(await svc.isTokenRevoked('abc')).toBe(false);
      } finally {
        warn.mockRestore();
      }
    });

    it('revokeToken WARNs once per attempt when the denylist write fails', async () => {
      const prisma = new PrismaService({
        user: { findFirst: jest.fn() },
        revokedToken: {
          create: jest.fn(async () => {
            throw new Error('db down');
          }),
          findFirst: jest.fn(async () => null),
        },
      } as any);
      const config = new RhinoConfigService(
        normalizeConfig({ models: {}, auth: { jwtSecret: 't' } }),
      );
      const svc = new AuthService(prisma, config);
      const warn = jest
        .spyOn((svc as any).logger, 'warn')
        .mockImplementation(() => undefined);
      try {
        await svc.revokeToken('abc');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/failed to persist/);
      } finally {
        warn.mockRestore();
      }
    });

    it('revokeToken ignores empty tokens', async () => {
      const svc = setup({ findFirst: jest.fn() });
      await expect(svc.revokeToken('')).resolves.toBeUndefined();
    });
  });
});
