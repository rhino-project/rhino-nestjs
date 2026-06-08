import { BadRequestException } from '@nestjs/common';
import { NestedService } from './nested.service';
import { ValidationService } from './validation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';

// Coverage for nested-operation guards and the transaction executor branches.
// No production code changes.
describe('NestedService.execute — coverage', () => {
  function makeSvc(models: any, tx: any, nested?: any) {
    const prisma = new PrismaService({ $transaction: async (fn: any) => fn(tx) });
    const config = new RhinoConfigService(normalizeConfig({ models, ...(nested ? { nested } : {}) }));
    return new NestedService(prisma, config, new ValidationService());
  }
  const posts = { posts: { model: 'post' } };

  it('rejects an empty operation list', async () => {
    await expect(makeSvc(posts, {}).execute([], {} as any)).rejects.toThrow('No operations provided');
  });

  it('rejects more operations than the configured maximum', async () => {
    const svc = makeSvc(posts, {}, { maxOperations: 1 });
    const ops = [
      { model: 'posts', action: 'create', data: {} },
      { model: 'posts', action: 'create', data: {} },
    ];
    await expect(svc.execute(ops as any, {} as any)).rejects.toThrow(/Too many operations/);
  });

  it('rejects an operation missing model or action', async () => {
    await expect(makeSvc(posts, {}).execute([{ action: 'create' } as any], {} as any)).rejects.toThrow(
      /must have model and action/,
    );
    await expect(makeSvc(posts, {}).execute([{ model: 'posts' } as any], {} as any)).rejects.toThrow(
      /must have model and action/,
    );
  });

  it('rejects an unsupported action', async () => {
    await expect(
      makeSvc(posts, {}).execute([{ model: 'posts', action: 'archive' } as any], {} as any),
    ).rejects.toThrow(/Unsupported action/);
  });

  it('rejects update/delete without an id', async () => {
    await expect(
      makeSvc(posts, {}).execute([{ model: 'posts', action: 'update', data: {} } as any], {} as any),
    ).rejects.toThrow(/requires an id/);
  });

  it('rejects an unknown model', async () => {
    await expect(
      makeSvc(posts, {}).execute([{ model: 'ghosts', action: 'create', data: {} } as any], {} as any),
    ).rejects.toThrow(/Unknown model/);
  });

  it('rejects a model not in the nested allow-list', async () => {
    const svc = makeSvc(posts, {}, { allowedModels: ['comments'] });
    await expect(
      svc.execute([{ model: 'posts', action: 'create', data: {} } as any], {} as any),
    ).rejects.toThrow(/not allowed/);
  });

  it('throws when the Prisma delegate is missing in the transaction', async () => {
    // tx has no `post` delegate
    await expect(
      makeSvc(posts, {}).execute([{ model: 'posts', action: 'create', data: { title: 'x' } } as any], {} as any),
    ).rejects.toThrow(/Prisma delegate missing/);
  });

  it('soft-delete throws "not found or cross-tenant" when count is 0', async () => {
    const tx = { post: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const svc = makeSvc({ posts: { model: 'post', softDeletes: true } }, tx);
    await expect(
      svc.execute([{ model: 'posts', action: 'delete', id: 999 } as any], {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hard-delete throws when count is 0', async () => {
    const tx = { post: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const svc = makeSvc({ posts: { model: 'post' } }, tx);
    await expect(
      svc.execute([{ model: 'posts', action: 'delete', id: 999 } as any], {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update throws "not found or cross-tenant" when count is 0', async () => {
    const tx = { post: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findFirst: jest.fn() } };
    const svc = makeSvc({ posts: { model: 'post' } }, tx);
    await expect(
      svc.execute([{ model: 'posts', action: 'update', id: 1, data: { title: 'x' } } as any], {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path: a create returns its new record', async () => {
    const tx = { post: { create: jest.fn().mockResolvedValue({ id: 1, title: 'x' }) } };
    const svc = makeSvc({ posts: { model: 'post' } }, tx);
    const res = await svc.execute([{ model: 'posts', action: 'create', data: { title: 'x' } } as any], {} as any);
    expect(res).toEqual([{ index: 0, model: 'posts', action: 'create', id: 1, data: { id: 1, title: 'x' } }]);
  });
});
