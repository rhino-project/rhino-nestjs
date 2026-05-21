import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { ForbiddenException } from '@nestjs/common';

function ctxUser(orgId = 1, perms: string[] = ['*']) {
  return {
    user: { id: 1, userRoles: [{ organizationId: orgId, permissions: perms }] },
    organization: { id: orgId },
  };
}

describe('NestedController (integration)', () => {
  const cfg = {
    models: {
      posts: {
        model: 'post',
        belongsToOrganization: true,
        validation: z.object({ title: z.string() }),
      },
      comments: {
        model: 'comment',
        validation: z.object({ postId: z.number(), body: z.string() }),
      },
    },
  };

  it('creates multiple records atomically and resolves $N references', async () => {
    const env = buildEnv(cfg);
    const res: any = await env.controllers.nested.run(
      {
        operations: [
          { model: 'posts', action: 'create', data: { title: 'post' } },
          {
            model: 'comments',
            action: 'create',
            data: { postId: '$0.id', body: 'first comment' },
          },
        ],
      },
      ctxUser() as any,
    );
    expect(res.data).toHaveLength(2);
    expect(res.data[1].data.postId).toBe(res.data[0].data.id);
  });

  it('denies when the policy denies one operation', async () => {
    const env = buildEnv(cfg);
    await expect(
      env.controllers.nested.run(
        {
          operations: [{ model: 'posts', action: 'create', data: { title: 'x' } }],
        },
        ctxUser(1, ['comments.*']) as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('supports delete action', async () => {
    const env = buildEnv(cfg, {
      post: [{ id: 1, title: 'del-me', organizationId: 1 }],
    });
    const res: any = await env.controllers.nested.run(
      { operations: [{ model: 'posts', action: 'delete', id: 1 }] },
      ctxUser() as any,
    );
    expect(res.data[0]).toMatchObject({ action: 'delete', id: 1 });
    expect(env.client._data.post).toHaveLength(0);
  });

  it('delete refuses cross-tenant records', async () => {
    const env = buildEnv(cfg, {
      post: [{ id: 1, title: 'other-org', organizationId: 99 }],
    });
    await expect(
      env.controllers.nested.run(
        { operations: [{ model: 'posts', action: 'delete', id: 1 }] },
        ctxUser() as any,
      ),
    ).rejects.toThrow(/not found/i);
    expect(env.client._data.post).toHaveLength(1);
  });

  it('delete requires an id', async () => {
    const env = buildEnv(cfg);
    await expect(
      env.controllers.nested.run(
        { operations: [{ model: 'posts', action: 'delete' } as any] },
        ctxUser() as any,
      ),
    ).rejects.toThrow(/requires an id/);
  });

  it('delete performs soft delete when configured', async () => {
    const softCfg = {
      models: {
        posts: { ...cfg.models.posts, softDeletes: true },
      },
    };
    const env = buildEnv(softCfg, {
      post: [{ id: 1, title: 'x', organizationId: 1 }],
    });
    await env.controllers.nested.run(
      { operations: [{ model: 'posts', action: 'delete', id: 1 }] },
      ctxUser() as any,
    );
    expect(env.client._data.post[0].deletedAt).toBeInstanceOf(Date);
  });

  it('injects organizationId on tenant models', async () => {
    const env = buildEnv(cfg);
    await env.controllers.nested.run(
      {
        operations: [{ model: 'posts', action: 'create', data: { title: 'x' } }],
      },
      ctxUser() as any,
    );
    expect(env.client._data.post[0].organizationId).toBe(1);
  });
});
