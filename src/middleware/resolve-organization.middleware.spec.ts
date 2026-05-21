import { ResolveOrganizationMiddleware } from './resolve-organization.middleware';

describe('ResolveOrganizationMiddleware', () => {
  it('no-ops when no :organization param', async () => {
    const mw = new ResolveOrganizationMiddleware({
      resolve: jest.fn(),
    } as any);
    const req: any = { params: {} };
    const next = jest.fn();
    await mw.use(req, {} as any, next);
    expect(next).toHaveBeenCalled();
    expect(req.organization).toBeUndefined();
  });

  it('attaches the resolved organization to req', async () => {
    const org = { id: 1, slug: 'acme' };
    const resolve = jest.fn().mockResolvedValue(org);
    const mw = new ResolveOrganizationMiddleware({ resolve } as any);
    const req: any = { params: { organization: 'acme' }, user: { id: 1 } };
    const next = jest.fn();
    await mw.use(req, {} as any, next);
    expect(req.organization).toEqual(org);
    expect(resolve).toHaveBeenCalledWith('acme', { id: 1 });
  });

  it('supports :org as alternative param name', async () => {
    const org = { id: 1 };
    const resolve = jest.fn().mockResolvedValue(org);
    const mw = new ResolveOrganizationMiddleware({ resolve } as any);
    const req: any = { params: { org: '1' } };
    const next = jest.fn();
    await mw.use(req, {} as any, next);
    expect(req.organization).toEqual(org);
  });
});
