import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';

function ctxUser(orgId = 1, perms = ['posts.*']) {
  return {
    user: { id: 1, email: 'a@b.c', userRoles: [{ organizationId: orgId, permissions: perms }] },
    organization: { id: orgId, slug: 'acme' },
  };
}

class PostPolicy extends ResourcePolicy {}

describe('GlobalController (integration)', () => {
  const baseCfg = {
    models: {
      posts: {
        model: 'post',
        policy: PostPolicy,
        belongsToOrganization: true,
        validation: z.object({
          title: z.string().min(1),
          body: z.string().optional(),
        }),
        allowedFilters: ['status'],
        allowedSorts: ['createdAt', 'title'],
        allowedSearch: ['title'],
        paginationEnabled: true,
        perPage: 2,
      },
    },
  };

  it('index returns paginated envelope', async () => {
    const env = buildEnv(baseCfg, {
      post: [
        { id: 1, title: 'a', organizationId: 1 },
        { id: 2, title: 'b', organizationId: 1 },
        { id: 3, title: 'c', organizationId: 1 },
        { id: 4, title: 'x', organizationId: 2 }, // other org — must not leak
      ],
    });
    const res: any = await env.controllers.global.index('posts', {}, ctxUser() as any);
    expect(res.__rhinoPaginated).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(3); // only org 1 records counted
    expect(res.perPage).toBe(2);
    expect(res.lastPage).toBe(2);
  });

  it('index does not leak records from other organizations', async () => {
    const env = buildEnv(baseCfg, {
      post: [
        { id: 1, title: 'mine', organizationId: 1 },
        { id: 2, title: 'other', organizationId: 2 },
      ],
    });
    const res: any = await env.controllers.global.index('posts', {}, ctxUser() as any);
    expect(res.items.map((r: any) => r.title)).toEqual(['mine']);
  });

  it('store persists and injects organizationId', async () => {
    const env = buildEnv(baseCfg);
    const res = await env.controllers.global.store(
      'posts',
      { title: 'hello' },
      ctxUser() as any,
    );
    expect(res).toMatchObject({ id: expect.any(Number), title: 'hello' });
    expect(env.client._data.post[0].organizationId).toBe(1);
  });

  it('store validates required fields', async () => {
    const env = buildEnv(baseCfg);
    await expect(
      env.controllers.global.store('posts', { title: '' }, ctxUser() as any),
    ).rejects.toThrow();
  });

  it('store rejects forbidden fields when policy narrows', async () => {
    class NarrowPolicy extends ResourcePolicy {
      permittedAttributesForCreate() {
        return ['title'];
      }
    }
    const env = buildEnv({
      models: {
        posts: {
          ...baseCfg.models.posts,
          policy: NarrowPolicy,
          validation: z.object({ title: z.string() }),
        },
      },
    });
    await expect(
      env.controllers.global.store(
        'posts',
        { title: 't', budget: 1000 },
        ctxUser() as any,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_FIELDS' });
  });

  it('update rejects attempts to change organizationId', async () => {
    const env = buildEnv(baseCfg, {
      post: [{ id: 1, title: 'a', organizationId: 1 }],
    });
    const res = await env.controllers.global.update(
      'posts',
      '1',
      { title: 'b', organizationId: 999 },
      ctxUser() as any,
    );
    expect((res as any).organizationId).toBe(1);
    expect((res as any).title).toBe('b');
  });

  it('update 404 for record in another org', async () => {
    const env = buildEnv(baseCfg, {
      post: [{ id: 1, title: 'a', organizationId: 99 }],
    });
    await expect(
      env.controllers.global.update('posts', '1', { title: 'b' }, ctxUser() as any),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('destroy performs soft delete when configured', async () => {
    const env = buildEnv(
      {
        models: {
          posts: { ...baseCfg.models.posts, softDeletes: true },
        },
      },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await env.controllers.global.destroy('posts', '1', ctxUser() as any);
    expect(env.client._data.post[0].deletedAt).toBeInstanceOf(Date);
    expect(env.client._data.post).toHaveLength(1);
  });

  it('trashed lists only soft-deleted records', async () => {
    const env = buildEnv(
      {
        models: { posts: { ...baseCfg.models.posts, softDeletes: true } },
      },
      {
        post: [
          { id: 1, title: 'a', organizationId: 1, deletedAt: new Date() },
          { id: 2, title: 'b', organizationId: 1, deletedAt: null },
        ],
      },
    );
    const res: any = await env.controllers.global.trashed('posts', {}, ctxUser() as any);
    expect(res.items.map((r: any) => r.id)).toEqual([1]);
  });

  it('restore brings back a soft-deleted record', async () => {
    const env = buildEnv(
      {
        models: { posts: { ...baseCfg.models.posts, softDeletes: true } },
      },
      { post: [{ id: 1, title: 'a', organizationId: 1, deletedAt: new Date() }] },
    );
    await env.controllers.global.restore('posts', '1', ctxUser() as any);
    expect(env.client._data.post[0].deletedAt).toBeNull();
  });

  it('forceDelete removes record permanently', async () => {
    const env = buildEnv(
      {
        models: { posts: { ...baseCfg.models.posts, softDeletes: true } },
      },
      { post: [{ id: 1, title: 'a', organizationId: 1, deletedAt: new Date() }] },
    );
    await env.controllers.global.forceDelete('posts', '1', ctxUser() as any);
    expect(env.client._data.post).toHaveLength(0);
  });

  it('writes audit log entry on create when hasAuditTrail', async () => {
    const env = buildEnv(
      {
        models: {
          posts: { ...baseCfg.models.posts, hasAuditTrail: true },
        },
      },
    );
    await env.controllers.global.store('posts', { title: 't' }, ctxUser() as any);
    const audit = env.client._data.auditLog ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      auditableType: 'post',
      action: 'created',
      organizationId: 1,
      userId: 1,
    });
  });

  it('serializer strips base hidden columns from response', async () => {
    const env = buildEnv(baseCfg, {
      post: [{ id: 1, title: 'a', organizationId: 1, createdAt: new Date(), password: 'x' }],
    });
    const res: any = await env.controllers.global.show('posts', '1', {}, ctxUser() as any);
    expect(res).toEqual({ id: 1, title: 'a', organizationId: 1 });
  });

  it('rejects includes when user lacks viewAny on the related resource', async () => {
    class PostPolicy extends ResourcePolicy {}
    class SecretPolicy extends ResourcePolicy {
      viewAny() { return false; }
    }
    const env = buildEnv({
      models: {
        posts: { model: 'post', policy: PostPolicy, belongsToOrganization: true, allowedIncludes: ['secrets'] },
        secrets: { model: 'secret', policy: SecretPolicy, belongsToOrganization: true },
      },
    }, {
      post: [{ id: 1, title: 'a', organizationId: 1 }],
    });
    await expect(
      env.controllers.global.index('posts', { include: 'secrets' }, ctxUser() as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('verifies FK belongs to current organization on create', async () => {
    class PostPolicy extends ResourcePolicy {}
    const env = buildEnv({
      models: {
        posts: {
          model: 'post',
          policy: PostPolicy,
          belongsToOrganization: true,
          validation: z.object({ title: z.string(), projectId: z.number() }),
          fkConstraints: [{ field: 'projectId', model: 'project' }],
        },
      },
    }, {
      project: [{ id: 99, organizationId: 99 }], // other org
    });
    await expect(
      env.controllers.global.store(
        'posts',
        { title: 'x', projectId: 99 },
        ctxUser() as any,
      ),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT' });
  });

  it('accepts FK when the referenced record belongs to current org', async () => {
    class PostPolicy extends ResourcePolicy {}
    const env = buildEnv({
      models: {
        posts: {
          model: 'post',
          policy: PostPolicy,
          belongsToOrganization: true,
          validation: z.object({ title: z.string(), projectId: z.number() }),
          fkConstraints: [{ field: 'projectId', model: 'project' }],
        },
      },
    }, {
      project: [{ id: 7, organizationId: 1 }],
    });
    const res = await env.controllers.global.store(
      'posts',
      { title: 'ok', projectId: 7 },
      ctxUser() as any,
    );
    expect((res as any).title).toBe('ok');
  });

  // -------------------------------------------------------------------
  // BP-007 integration: GlobalController threads {user, organization}
  // through SerializerService so role-keyed policies work end-to-end.
  // -------------------------------------------------------------------
  describe('BP-007: role-keyed policy whitelist works through GlobalController', () => {
    class ProjectPolicy extends ResourcePolicy {
      permittedAttributesForShow(user: any, org?: any): string[] {
        if (this.hasRole(user, 'admin', org)) return ['*'];
        if (this.hasRole(user, 'manager', org)) return ['id', 'title', 'budget'];
        if (this.hasRole(user, 'viewer', org)) return ['id', 'title'];
        return [];
      }
      hiddenAttributesForShow(user: any, org?: any): string[] {
        if (this.hasRole(user, 'viewer', org)) return ['budget', 'internalNotes'];
        return [];
      }
    }
    const cfg = {
      models: {
        projects: {
          model: 'project',
          policy: ProjectPolicy,
          belongsToOrganization: true,
          paginationEnabled: false,
        },
      },
    };
    const fullProject = {
      id: 1,
      title: 'Website',
      budget: 50000,
      internalNotes: 'secret',
      organizationId: 1,
    };
    const makeCtx = (roleSlug: string, orgId = 1) => ({
      user: {
        id: 1,
        userRoles: [
          {
            organizationId: orgId,
            role: { slug: roleSlug },
            permissions: ['*'],
          },
        ],
      },
      organization: { id: 1, slug: 'acme' },
    });

    it('admin (role resolved via org) sees the full project on show', async () => {
      const env = buildEnv(cfg, { project: [fullProject] });
      const res: any = await env.controllers.global.show('projects', '1', {}, makeCtx('admin') as any);
      expect(res).toMatchObject({
        id: 1,
        title: 'Website',
        budget: 50000,
        internalNotes: 'secret',
      });
    });

    it('admin sees all fields on index too (serializeMany threads org)', async () => {
      const env = buildEnv(cfg, { project: [fullProject] });
      const res: any = await env.controllers.global.index('projects', {}, makeCtx('admin') as any);
      expect(res.data[0]).toMatchObject({
        id: 1,
        title: 'Website',
        budget: 50000,
        internalNotes: 'secret',
      });
    });

    it('viewer sees only id + title', async () => {
      const env = buildEnv(cfg, { project: [fullProject] });
      const res: any = await env.controllers.global.show('projects', '1', {}, makeCtx('viewer') as any);
      expect(res).toEqual({ id: 1, title: 'Website' });
    });

    it('manager sees budget but not internalNotes on index', async () => {
      const env = buildEnv(cfg, { project: [fullProject] });
      const res: any = await env.controllers.global.index('projects', {}, makeCtx('manager') as any);
      expect(res.data[0]).toEqual({ id: 1, title: 'Website', budget: 50000 });
    });
  });

  it('exceptActions blocks a disabled action with ACTION_DISABLED code', async () => {
    const env = buildEnv({
      models: {
        posts: { ...baseCfg.models.posts, exceptActions: ['destroy'] },
      },
    });
    await expect(
      env.controllers.global.destroy('posts', '1', ctxUser() as any),
    ).rejects.toMatchObject({ code: 'ACTION_DISABLED' });
  });
});
