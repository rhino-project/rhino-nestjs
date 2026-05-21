import { NestedService } from './nested.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { ValidationService } from './validation.service';
import { BadRequestException } from '@nestjs/common';

function makeSvc(models: Record<string, any>, tx: any) {
  const prisma = new PrismaService({
    $transaction: async (fn: any) => fn(tx),
  });
  const config = new RhinoConfigService(normalizeConfig({ models }));
  return new NestedService(prisma, config, new ValidationService());
}

describe('NestedService', () => {
  it('rejects empty operations', async () => {
    const svc = makeSvc({}, {});
    await expect(svc.execute([], {})).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown models', async () => {
    const svc = makeSvc({ posts: { model: 'post' } }, {});
    await expect(
      svc.execute([{ model: 'wat', action: 'create', data: {} }], {}),
    ).rejects.toThrow(/Unknown model/);
  });

  it('rejects when exceeding maxOperations', async () => {
    const prisma = new PrismaService({ $transaction: async (fn: any) => fn({}) });
    const config = new RhinoConfigService(normalizeConfig({
      models: { posts: { model: 'post' } },
      nested: { maxOperations: 1 },
    }));
    const svc = new NestedService(prisma, config, new ValidationService());
    const ops = [
      { model: 'posts', action: 'create' as const, data: {} },
      { model: 'posts', action: 'create' as const, data: {} },
    ];
    await expect(svc.execute(ops, {})).rejects.toThrow(/Too many operations/);
  });

  it('executes create and returns results', async () => {
    const tx = {
      post: { create: jest.fn().mockResolvedValue({ id: 1, title: 't' }) },
    };
    const svc = makeSvc({ posts: { model: 'post' } }, tx);
    const out = await svc.execute(
      [{ model: 'posts', action: 'create', data: { title: 't' } }],
      {},
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 0, model: 'posts', action: 'create', id: 1 });
  });

  it('resolves $N.field references to prior results', async () => {
    const tx = {
      post: { create: jest.fn().mockResolvedValue({ id: 99, title: 'p' }) },
      comment: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 1, ...data })),
      },
    };
    const svc = makeSvc(
      { posts: { model: 'post' }, comments: { model: 'comment' } },
      tx,
    );
    await svc.execute(
      [
        { model: 'posts', action: 'create', data: { title: 'p' } },
        { model: 'comments', action: 'create', data: { postId: '$0.id', body: 'c' } },
      ],
      {},
    );
    expect(tx.comment.create).toHaveBeenCalledWith({
      data: { postId: 99, body: 'c' },
    });
  });

  it('injects organizationId on create when belongsToOrganization', async () => {
    const tx = {
      post: { create: jest.fn().mockImplementation(({ data }) => ({ id: 1, ...data })) },
    };
    const svc = makeSvc({ posts: { model: 'post', belongsToOrganization: true } }, tx);
    await svc.execute(
      [{ model: 'posts', action: 'create', data: { title: 'x' } }],
      { organization: { id: 42 } },
    );
    expect(tx.post.create).toHaveBeenCalledWith({
      data: { title: 'x', organizationId: 42 },
    });
  });

  it('surfaces validation errors with operation index', async () => {
    const tx = { post: { create: jest.fn() } };
    const { z } = require('zod');
    const svc = makeSvc(
      { posts: { model: 'post', validationStore: z.object({ title: z.string() }) } },
      tx,
    );
    await expect(
      svc.execute([{ model: 'posts', action: 'create', data: {} }], {}),
    ).rejects.toMatchObject({ response: expect.objectContaining({ operationIndex: 0 }) });
  });

  it('rejects allowedModels violations', async () => {
    const prisma = new PrismaService({ $transaction: async (fn: any) => fn({}) });
    const config = new RhinoConfigService(normalizeConfig({
      models: { posts: { model: 'post' } },
      nested: { allowedModels: ['comments'] },
    }));
    const svc = new NestedService(prisma, config, new ValidationService());
    await expect(
      svc.execute([{ model: 'posts', action: 'create', data: {} }], {}),
    ).rejects.toThrow(/not allowed/);
  });
});
