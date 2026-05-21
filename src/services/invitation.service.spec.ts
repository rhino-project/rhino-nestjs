import { InvitationService } from './invitation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function setup(initial: any = []) {
  let autoId = 1;
  const store = initial.map((i: any) => ({ ...i }));
  const delegate = {
    findMany: jest.fn().mockImplementation(({ where }) => {
      return Promise.resolve(
        store.filter((r: any) => {
          if (where.organizationId != null && r.organizationId !== where.organizationId) return false;
          if (where.status && r.status !== where.status) return false;
          return true;
        }),
      );
    }),
    findUnique: jest.fn().mockImplementation(({ where }) => {
      return Promise.resolve(store.find((r: any) => r.id === where.id || r.token === where.token) ?? null);
    }),
    create: jest.fn().mockImplementation(({ data }) => {
      const rec = { id: autoId++, ...data };
      store.push(rec);
      return Promise.resolve(rec);
    }),
    update: jest.fn().mockImplementation(({ where, data }) => {
      const rec = store.find((r: any) => r.id === where.id);
      Object.assign(rec, data);
      return Promise.resolve(rec);
    }),
  };
  const userRole = { create: jest.fn().mockResolvedValue({}) };
  const role = { findUnique: jest.fn().mockResolvedValue({ id: 1, slug: 'admin' }) };
  const prisma = new PrismaService({ organizationInvitation: delegate, userRole, role });
  const config = new RhinoConfigService(normalizeConfig({ models: {} }));
  return { svc: new InvitationService(prisma, config), delegate, userRole, role, store };
}

describe('InvitationService', () => {
  it('creates with a 64-char token and pending status', async () => {
    const { svc, delegate } = setup();
    const inv = await svc.create({
      email: 'x@y.com',
      roleId: 1,
      organization: { id: 5 },
      invitedBy: { id: 1 },
    });
    expect(inv.status).toBe('pending');
    expect(inv.token).toHaveLength(64);
    expect(delegate.create).toHaveBeenCalled();
  });

  it('calls notificationHandler if configured', async () => {
    const handler = jest.fn();
    const prisma = new PrismaService({
      organizationInvitation: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    });
    const config = new RhinoConfigService(
      normalizeConfig({ models: {}, invitations: { notificationHandler: handler } }),
    );
    const svc = new InvitationService(prisma, config);
    await svc.create({ email: 'x@y.com', roleId: 1, organization: { id: 5 }, invitedBy: { id: 1 } });
    expect(handler).toHaveBeenCalled();
  });

  it('resend rotates the token', async () => {
    const { svc, store } = setup([
      { id: 1, token: 'OLD', status: 'pending', expiresAt: new Date(), organizationId: 5 },
    ]);
    await svc.resend(1);
    expect(store[0].token).not.toBe('OLD');
  });

  it('resend rejects non-pending invitations', async () => {
    const { svc } = setup([
      { id: 1, token: 'x', status: 'accepted', expiresAt: new Date(), organizationId: 5 },
    ]);
    await expect(svc.resend(1)).rejects.toThrow(BadRequestException);
  });

  it('cancel marks as cancelled', async () => {
    const { svc, store } = setup([
      { id: 1, token: 'x', status: 'pending', expiresAt: new Date(), organizationId: 5 },
    ]);
    await svc.cancel(1);
    expect(store[0].status).toBe('cancelled');
  });

  it('accept: expired invitation flips to expired', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const { svc, store } = setup([
      {
        id: 1,
        token: 'xyz',
        status: 'pending',
        expiresAt: past,
        organizationId: 5,
        organization: { id: 5 },
        role: { id: 1 },
      },
    ]);
    await expect(svc.accept('xyz', 1)).rejects.toThrow(/expired/);
    expect(store[0].status).toBe('expired');
  });

  it('accept: unauthenticated returns requiresRegistration', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const { svc } = setup([
      {
        id: 1,
        token: 'ok',
        status: 'pending',
        expiresAt: future,
        organizationId: 5,
        organization: { id: 5 },
        role: { id: 1 },
        email: 'x@y.com',
      },
    ]);
    const res = await svc.accept('ok');
    expect(res).toMatchObject({ requiresRegistration: true });
  });

  it('accept: authenticated creates user role and marks accepted', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const { svc, userRole, store } = setup([
      {
        id: 1,
        token: 'ok',
        status: 'pending',
        expiresAt: future,
        organizationId: 5,
        roleId: 9,
        organization: { id: 5 },
        role: { id: 9 },
      },
    ]);
    const res = await svc.accept('ok', 42);
    expect(res).toMatchObject({ accepted: true });
    expect(store[0].status).toBe('accepted');
    expect(userRole.create).toHaveBeenCalledWith({
      data: { userId: 42, organizationId: 5, roleId: 9, permissions: [] },
    });
  });

  it('rejects unknown invitation token', async () => {
    const { svc } = setup();
    await expect(svc.accept('nope')).rejects.toThrow(NotFoundException);
  });

  it('rejects creating invitation when role not in allowedRoles', async () => {
    const prisma = new PrismaService({
      organizationInvitation: { create: jest.fn() },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 2, slug: 'viewer' }) },
    });
    const config = new RhinoConfigService(
      normalizeConfig({ models: {}, invitations: { allowedRoles: ['admin'] } }),
    );
    const svc = new InvitationService(prisma, config);
    await expect(
      svc.create({ email: 'x@y.com', roleId: 2, organization: { id: 1 }, invitedBy: { id: 1 } }),
    ).rejects.toThrow(/not allowed/);
  });
});
