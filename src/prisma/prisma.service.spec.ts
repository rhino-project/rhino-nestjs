import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('throws a helpful error if no client is configured', () => {
    const s = new PrismaService();
    expect(() => s.client).toThrow(/no Prisma client/);
  });

  it('returns the configured client', () => {
    const fakeClient = { $connect: jest.fn(), $disconnect: jest.fn(), user: {} };
    const s = new PrismaService(fakeClient);
    expect(s.client).toBe(fakeClient);
  });

  it('resolves model delegates by exact/camel/lower names', () => {
    const user = {};
    const orgInv = {};
    const fakeClient = { user, organizationInvitation: orgInv };
    const s = new PrismaService(fakeClient);
    expect(s.model('user')).toBe(user);
    expect(s.model('User')).toBe(user);
    expect(s.model('organizationInvitation')).toBe(orgInv);
    expect(s.model('OrganizationInvitation')).toBe(orgInv);
  });

  it('throws for unknown models', () => {
    const s = new PrismaService({ user: {} });
    expect(() => s.model('widget')).toThrow(/unknown model/);
  });

  it('swallows connect/disconnect errors in lifecycle hooks', async () => {
    const broken = {
      $connect: () => Promise.reject(new Error('no db')),
      $disconnect: () => Promise.reject(new Error('no db')),
    };
    const s = new PrismaService(broken);
    await expect(s.onModuleInit()).resolves.toBeUndefined();
    await expect(s.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('no-ops lifecycle hooks when no client configured', async () => {
    const s = new PrismaService();
    await expect(s.onModuleInit()).resolves.toBeUndefined();
    await expect(s.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('$transaction delegates to the client', async () => {
    const client = {
      $transaction: (fn: any) => fn({ inner: true }),
    };
    const s = new PrismaService(client);
    const result = await s.$transaction(async (tx: any) => tx);
    expect(result).toEqual({ inner: true });
  });
});
