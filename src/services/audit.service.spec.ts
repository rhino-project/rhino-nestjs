import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  it('writes a log entry with all fields', async () => {
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const svc = new AuditService(new PrismaService({ auditLog }));
    await svc.log({
      auditableType: 'Post',
      auditableId: 5,
      action: 'created',
      newValues: { title: 'hi' },
      ctx: {
        user: { id: 1 },
        organization: { id: 7 },
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      },
    });
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auditableType: 'Post',
        auditableId: 5,
        action: 'created',
        newValues: { title: 'hi' },
        userId: 1,
        organizationId: 7,
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      }),
    });
  });

  it('strips passwords and exclude fields from logged values', async () => {
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const svc = new AuditService(new PrismaService({ auditLog }));
    await svc.log({
      auditableType: 'User',
      auditableId: 1,
      action: 'updated',
      oldValues: { name: 'A', password: 'secret', ssn: 'x' },
      newValues: { name: 'B', password: 'secret2', ssn: 'y' },
      excludeFields: ['ssn'],
    });
    const arg = auditLog.create.mock.calls[0][0].data;
    expect(arg.oldValues).toEqual({ name: 'A' });
    expect(arg.newValues).toEqual({ name: 'B' });
  });

  it('silently ignores when auditLog model is missing', async () => {
    const svc = new AuditService(new PrismaService({}));
    await expect(
      svc.log({ auditableType: 'X', auditableId: 1, action: 'created' }),
    ).resolves.toBeUndefined();
  });

  it('diff returns only changed fields', () => {
    const svc = new AuditService(new PrismaService({}));
    const result = svc.diff(
      { id: 1, title: 'old', status: 'draft' },
      { id: 1, title: 'new', status: 'draft' },
      { model: 'post' },
    );
    expect(result).toEqual({ old: { title: 'old' }, new: { title: 'new' } });
  });

  it('diff returns null when nothing changed', () => {
    const svc = new AuditService(new PrismaService({}));
    const result = svc.diff({ a: 1 }, { a: 1 }, { model: 'x' });
    expect(result).toBeNull();
  });

  it('diff excludes updatedAt changes', () => {
    const svc = new AuditService(new PrismaService({}));
    const result = svc.diff(
      { a: 1, updatedAt: new Date('2020') },
      { a: 1, updatedAt: new Date('2021') },
      { model: 'x' },
    );
    expect(result).toBeNull();
  });
});
