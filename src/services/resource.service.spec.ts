import { ResourceService } from './resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { QueryBuilderService } from './query-builder.service';
import { ScopeService } from './scope.service';

function makeService(models: Record<string, any>, client: any) {
  const prisma = new PrismaService(client);
  const config = new RhinoConfigService(normalizeConfig({ models }));
  return new ResourceService(prisma, config, new QueryBuilderService(), new ScopeService());
}

describe('ResourceService', () => {
  it('findAll returns paginated items with total', async () => {
    const post = {
      findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      count: jest.fn().mockResolvedValue(2),
    };
    const svc = makeService(
      { posts: { model: 'post', paginationEnabled: true, perPage: 10 } },
      { post },
    );
    const res = await svc.findAll('posts', {});
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(2);
    expect(res.page).toBe(1);
    expect(res.perPage).toBe(10);
    expect(res.lastPage).toBe(1);
  });

  it('findAll scopes by organization when belongsToOrganization', async () => {
    const post = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const svc = makeService(
      { posts: { model: 'post', belongsToOrganization: true } },
      { post },
    );
    await svc.findAll('posts', {}, { organization: { id: 7 } });
    expect(post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 7 }) }),
    );
  });

  it('findAll hides soft-deleted by default', async () => {
    const post = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    const svc = makeService({ posts: { model: 'post', softDeletes: true } }, { post });
    await svc.findAll('posts', {});
    expect(post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('onlyTrashed shows only deleted records', async () => {
    const post = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    const svc = makeService({ posts: { model: 'post', softDeletes: true } }, { post });
    await svc.findAll('posts', {}, { onlyTrashed: true });
    expect(post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: { not: null } } }),
    );
  });

  it('create injects organizationId when tenant model', async () => {
    const post = { create: jest.fn().mockResolvedValue({ id: 1, organizationId: 7 }) };
    const svc = makeService(
      { posts: { model: 'post', belongsToOrganization: true } },
      { post },
    );
    await svc.create('posts', { title: 'hi' }, { organization: { id: 7 } });
    expect(post.create).toHaveBeenCalledWith({
      data: { title: 'hi', organizationId: 7 },
    });
  });

  it('update strips organizationId to prevent tenant hijack', async () => {
    const post = { update: jest.fn().mockResolvedValue({ id: 1 }) };
    const svc = makeService({ posts: { model: 'post' } }, { post });
    await svc.update('posts', 1, { title: 'x', organizationId: 999 });
    expect(post.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { title: 'x' },
    });
  });

  it('update returns null when org scope excludes the row', async () => {
    const post = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
    };
    const svc = makeService({ posts: { model: 'post', belongsToOrganization: true } }, { post });
    const res = await svc.update('posts', 1, { title: 'x' }, { organization: { id: 7 } });
    expect(res).toBeNull();
    expect(post.findFirst).not.toHaveBeenCalled();
  });

  it('delete with softDeletes performs updateMany with deletedAt', async () => {
    const post = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const svc = makeService({ posts: { model: 'post', softDeletes: true } }, { post });
    const ok = await svc.delete('posts', 1);
    expect(ok).toBe(true);
    expect(post.updateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('restore sets deletedAt back to null', async () => {
    const post = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const svc = makeService({ posts: { model: 'post', softDeletes: true } }, { post });
    const ok = await svc.restore('posts', 1);
    expect(ok).toBe(true);
    expect(post.updateMany).toHaveBeenCalledWith({ where: { id: 1 }, data: { deletedAt: null } });
  });

  it('forceDelete hard-deletes via deleteMany when org scoped', async () => {
    const post = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const svc = makeService(
      { posts: { model: 'post', softDeletes: true, belongsToOrganization: true } },
      { post },
    );
    const ok = await svc.forceDelete('posts', 1, { organization: { id: 7 } });
    expect(ok).toBe(true);
    expect(post.deleteMany).toHaveBeenCalledWith({
      where: { id: 1, organizationId: 7 },
    });
  });

  it('applies registered scopes to findAll where', async () => {
    class OwnerOnlyScope {
      apply(where: any, ctx: any) {
        if (ctx.userRole === 'member') return { ...where, ownerId: ctx.user.id };
        return where;
      }
    }
    const post = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const svc = makeService(
      { posts: { model: 'post', scopes: [OwnerOnlyScope] } },
      { post },
    );
    await svc.findAll('posts', {}, {
      user: {
        id: 42,
        userRoles: [{ organizationId: 1, role: { slug: 'member' } }],
      },
      organization: { id: 1 },
    });
    expect(post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: 42 }) }),
    );
  });

  it('castId keeps uuid strings as strings', async () => {
    const post = { findFirst: jest.fn().mockResolvedValue({ id: 'abc' }) };
    const svc = makeService({ posts: { model: 'post', hasUuid: true } }, { post });
    await svc.findOne('posts', 'abc-123', {});
    expect(post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'abc-123' }) }),
    );
  });

  describe('configurable route key', () => {
    function makeServiceWithConfig(cfg: any, client: any) {
      const prisma = new PrismaService(client);
      const config = new RhinoConfigService(normalizeConfig(cfg));
      return new ResourceService(prisma, config, new QueryBuilderService(), new ScopeService());
    }

    it('findOne matches the route-key column and keeps a digit-only param a STRING', async () => {
      const job = { findFirst: jest.fn().mockResolvedValue({ id: 1, hashId: '48291' }) };
      const svc = makeService({ jobs: { model: 'job', routeKey: 'hashId' } }, { job });
      await svc.findOne('jobs', '48291', {});
      expect(job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ hashId: '48291' }) }),
      );
      // no Number() coercion and no `id` key in the where
      const where = job.findFirst.mock.calls[0][0].where;
      expect(where.hashId).toBe('48291');
      expect(where.id).toBeUndefined();
    });

    it('findOne keeps existing castId numification when routeKey is not set', async () => {
      const post = { findFirst: jest.fn().mockResolvedValue({ id: 5 }) };
      const svc = makeService({ posts: { model: 'post' } }, { post });
      await svc.findOne('posts', '5', {});
      expect(post.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 5 }) }),
      );
    });

    it('global routeKey applies when the model is silent; per-model beats global', async () => {
      const job = { findFirst: jest.fn().mockResolvedValue(null) };
      const post = { findFirst: jest.fn().mockResolvedValue(null) };
      const svc = makeServiceWithConfig(
        {
          routeKey: 'uuid',
          models: {
            jobs: { model: 'job', routeKey: 'hashId' },
            posts: { model: 'post' },
          },
        },
        { job, post },
      );
      await svc.findOne('jobs', 'h-1', {});
      expect(job.findFirst.mock.calls[0][0].where).toMatchObject({ hashId: 'h-1' });
      await svc.findOne('posts', 'u-1', {});
      expect(post.findFirst.mock.calls[0][0].where).toMatchObject({ uuid: 'u-1' });
    });

    it('update without org scope resolves via findFirst then mutates by primary key', async () => {
      const job = {
        findFirst: jest.fn().mockResolvedValue({ id: 9, hashId: 'h-9' }),
        update: jest.fn().mockResolvedValue({ id: 9, hashId: 'h-9', title: 'x' }),
      };
      const svc = makeService({ jobs: { model: 'job', routeKey: 'hashId' } }, { job });
      const res = await svc.update('jobs', 'h-9', { title: 'x' });
      expect(job.findFirst).toHaveBeenCalledWith({ where: { hashId: 'h-9' } });
      expect(job.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { title: 'x' } });
      expect(res).toMatchObject({ id: 9 });
    });

    it('update without org scope returns null when the hash matches nothing', async () => {
      const job = { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() };
      const svc = makeService({ jobs: { model: 'job', routeKey: 'hashId' } }, { job });
      const res = await svc.update('jobs', 'missing', { title: 'x' });
      expect(res).toBeNull();
      expect(job.update).not.toHaveBeenCalled();
    });

    it('delete (hard) without org scope resolves via findFirst then deletes by primary key', async () => {
      const job = {
        findFirst: jest.fn().mockResolvedValue({ id: 3, hashId: 'h-3' }),
        delete: jest.fn().mockResolvedValue({ id: 3 }),
      };
      const svc = makeService({ jobs: { model: 'job', routeKey: 'hashId' } }, { job });
      const ok = await svc.delete('jobs', 'h-3');
      expect(ok).toBe(true);
      expect(job.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });

    it('delete (hard) without org scope returns false when the hash matches nothing', async () => {
      const job = { findFirst: jest.fn().mockResolvedValue(null), delete: jest.fn() };
      const svc = makeService({ jobs: { model: 'job', routeKey: 'hashId' } }, { job });
      const ok = await svc.delete('jobs', 'missing');
      expect(ok).toBe(false);
      expect(job.delete).not.toHaveBeenCalled();
    });

    it('soft delete filters by the route-key column via updateMany', async () => {
      const job = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const svc = makeService(
        { jobs: { model: 'job', routeKey: 'hashId', softDeletes: true } },
        { job },
      );
      const ok = await svc.delete('jobs', 'h-1');
      expect(ok).toBe(true);
      expect(job.updateMany).toHaveBeenCalledWith({
        where: { hashId: 'h-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('restore filters by the route-key column', async () => {
      const job = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const svc = makeService(
        { jobs: { model: 'job', routeKey: 'hashId', softDeletes: true } },
        { job },
      );
      const ok = await svc.restore('jobs', 'h-1');
      expect(ok).toBe(true);
      expect(job.updateMany).toHaveBeenCalledWith({
        where: { hashId: 'h-1' },
        data: { deletedAt: null },
      });
    });

    it('forceDelete without org scope resolves then hard-deletes by primary key', async () => {
      const job = {
        findFirst: jest.fn().mockResolvedValue({ id: 4, hashId: 'h-4' }),
        delete: jest.fn().mockResolvedValue({ id: 4 }),
      };
      const svc = makeService(
        { jobs: { model: 'job', routeKey: 'hashId', softDeletes: true } },
        { job },
      );
      const ok = await svc.forceDelete('jobs', 'h-4');
      expect(ok).toBe(true);
      expect(job.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    });

    it('org-scoped mutations keep the count-based branch with a route-key where', async () => {
      const job = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const svc = makeService(
        { jobs: { model: 'job', routeKey: 'hashId', belongsToOrganization: true } },
        { job },
      );
      const ok = await svc.delete('jobs', 'h-7', { organization: { id: 7 } });
      expect(ok).toBe(true);
      expect(job.deleteMany).toHaveBeenCalledWith({
        where: { hashId: 'h-7', organizationId: 7 },
      });
    });
  });
});
