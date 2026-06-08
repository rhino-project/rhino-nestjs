import { BadRequestException } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';

// Coverage for invitation create/cancel guards. No production code changes.
describe('InvitationService — coverage', () => {
  function setup(initial: any[] = [], cfgOverrides: any = {}) {
    let autoId = 1;
    const store = initial.map((i) => ({ ...i }));
    const delegate = {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(store.find((r: any) => r.id === where.id || r.token === where.token) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const rec = { id: autoId++, ...data };
        store.push(rec);
        return Promise.resolve(rec);
      }),
      update: jest.fn(({ where, data }: any) => {
        const rec = store.find((r: any) => r.id === where.id);
        Object.assign(rec, data);
        return Promise.resolve(rec);
      }),
    };
    const prisma = new PrismaService({
      organizationInvitation: delegate,
      role: { findUnique: jest.fn().mockResolvedValue({ id: 1, slug: 'admin' }) },
    });
    const config = new RhinoConfigService(normalizeConfig({ models: {}, ...cfgOverrides }));
    return { svc: new InvitationService(prisma, config), delegate, store };
  }

  const baseInput = {
    email: 'x@y.com',
    roleId: 1,
    organization: { id: 5 },
    invitedBy: { id: 1, userRoles: [] },
  };

  it('rejects an invitation into the public group', async () => {
    const { svc } = setup();
    await expect(svc.create({ ...baseInput, routeGroup: 'public' })).rejects.toThrow(
      /Cannot invite into the public group/,
    );
  });

  it('denies a non-member inviter when group-membership enforcement is on (403)', async () => {
    const { svc } = setup([], {
      auth: { enforceGroupMembership: true },
      routeGroups: { driver: { models: '*' } },
    });
    await expect(
      svc.create({ ...baseInput, routeGroup: 'driver' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
  });

  it('creates a pending invitation on the happy path', async () => {
    const { svc, store } = setup();
    const inv = await svc.create({ ...baseInput });
    expect(inv).toMatchObject({ email: 'x@y.com', status: 'pending', organizationId: 5 });
    expect(store).toHaveLength(1);
  });

  it('cancel rejects a non-pending invitation', async () => {
    const { svc } = setup([{ id: 1, status: 'accepted', organizationId: 5 }]);
    await expect(svc.cancel(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancel sets a pending invitation to cancelled', async () => {
    const { svc, store } = setup([{ id: 1, status: 'pending', organizationId: 5 }]);
    await svc.cancel(1);
    expect(store[0].status).toBe('cancelled');
  });

  it('resend rejects a non-pending invitation', async () => {
    const { svc } = setup([{ id: 1, status: 'cancelled', organizationId: 5 }]);
    await expect(svc.resend(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancel of a missing invitation is a 404', async () => {
    const { svc } = setup([]);
    await expect(svc.cancel(999)).rejects.toThrow();
  });
});
