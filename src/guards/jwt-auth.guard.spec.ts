import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from '../services/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';

function makeGuard(userDelegate: any, jwtSecret = 'test-secret') {
  const prisma = new PrismaService({ user: userDelegate });
  // Multi-tenant on by default here so the userRoles include path is exercised
  // (matches the historical behavior these tests assert).
  const config = new RhinoConfigService(
    normalizeConfig({
      models: {},
      auth: { jwtSecret },
      multiTenant: { enabled: true, organizationModel: 'organization' },
    }),
  );
  const auth = new AuthService(prisma, config);
  return { guard: new JwtAuthGuard(auth, prisma, config), auth, prisma };
}

function makeOrglessGuard(userDelegate: any, jwtSecret = 'test-secret') {
  const prisma = new PrismaService({ user: userDelegate });
  // No multiTenant → org-less app: the guard must NOT attempt a userRoles include.
  const config = new RhinoConfigService(normalizeConfig({ models: {}, auth: { jwtSecret } }));
  const auth = new AuthService(prisma, config);
  return { guard: new JwtAuthGuard(auth, prisma, config), auth, prisma };
}

function makeCtx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('JwtAuthGuard', () => {
  it('short-circuits when req.__skipAuth is set (public group)', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    const req: any = { __skipAuth: true };
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
  });

  it('rejects when Authorization header is missing', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: {} })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects when Authorization scheme is not Bearer', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects when token is missing after Bearer', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: 'Bearer' } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects when JWT is invalid', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: 'Bearer not-a-jwt' } })),
    ).rejects.toThrow(RhinoException);
  });

  it('rejects when user record is not found', async () => {
    const { guard, auth } = makeGuard({ findUnique: jest.fn().mockResolvedValue(null) });
    const token = auth.signToken({ sub: 99 });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('attaches the user to req and returns true on success', async () => {
    const user = {
      id: 1,
      email: 'a@b.c',
      userRoles: [{ organizationId: 1, role: { slug: 'admin' }, permissions: [] }],
    };
    const { guard, auth } = makeGuard({ findUnique: jest.fn().mockResolvedValue(user) });
    const token = auth.signToken({ sub: 1, email: 'a@b.c' });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.user).toBe(user);
  });

  it('calls the user delegate with the right where + include', async () => {
    const user = { id: 7 };
    const findUnique = jest.fn().mockResolvedValue(user);
    const { guard, auth } = makeGuard({ findUnique });
    const token = auth.signToken({ sub: 7 });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    await guard.canActivate(makeCtx(req));
    // Preferred include eager-loads the org role layer (org_role_permissions).
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: { userRoles: { include: { role: { include: { orgRolePermissions: true } } } } },
    });
  });

  it('loads the user WITHOUT a userRoles include for an org-less app', async () => {
    const user = { id: 5, email: 'solo@x.io' };
    const findUnique = jest.fn(async (args: any) => {
      // A single-tenant User model has no userRoles relation: reject the include.
      if (args?.include) throw new Error('Unknown field `userRoles`');
      return user;
    });
    const { guard, auth } = makeOrglessGuard({ findUnique });
    const token = auth.signToken({ sub: 5 });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.user).toBe(user);
    // Org-less: only the plain lookup is attempted (no include path).
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0][0]).not.toHaveProperty('include');
  });

  it('falls back to a plain lookup when the userRoles include throws (multi-tenant)', async () => {
    const user = { id: 6 };
    const findUnique = jest.fn(async (args: any) => {
      if (args?.include) throw new Error('relation missing');
      return user;
    });
    const { guard, auth } = makeGuard({ findUnique });
    const token = auth.signToken({ sub: 6 });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.user).toBe(user);
    // Three tiers: deep include (role layer) → role-only include → plain lookup.
    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it('falls back to the role-only include when only the role-layer include throws', async () => {
    const user = { id: 8, userRoles: [] };
    const findUnique = jest.fn(async (args: any) => {
      // The deep org-role-layer include is unknown; the role-only include works.
      const include = args?.include?.userRoles?.include;
      if (include?.role?.include?.orgRolePermissions) throw new Error('relation missing');
      return user;
    });
    const { guard, auth } = makeGuard({ findUnique });
    const token = auth.signToken({ sub: 8 });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBe(true);
    expect(req.user).toBe(user);
    // Deep include throws, role-only include succeeds → no plain fallback.
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('coerces a non-string authorization header to string before splitting', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: 123 as any } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a token that has been revoked (hook-rejected login/register)', async () => {
    const user = { id: 1 };
    const prisma = new PrismaService({
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      revokedToken: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    } as any);
    const config = new RhinoConfigService(normalizeConfig({ models: {}, auth: { jwtSecret: 't' } }));
    const auth = new AuthService(prisma, config);
    const guard = new JwtAuthGuard(auth, prisma, config);
    const token = auth.signToken({ sub: 1 });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
