import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from '../services/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';

function makeGuard(userDelegate: any, jwtSecret = 'test-secret') {
  const prisma = new PrismaService({ user: userDelegate });
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
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: { userRoles: { include: { role: true } } },
    });
  });

  it('coerces a non-string authorization header to string before splitting', async () => {
    const { guard } = makeGuard({ findUnique: jest.fn() });
    await expect(
      guard.canActivate(makeCtx({ headers: { authorization: 123 as any } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
