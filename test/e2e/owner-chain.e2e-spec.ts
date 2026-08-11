import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';

class ProjectPolicy extends ResourcePolicy {}
class TaskPolicy extends ResourcePolicy {}
class CommentPolicy extends ResourcePolicy {}
class DocPolicy extends ResourcePolicy {}

/**
 * TaskFlow-shaped fixture: `projects` is the org-scoped root, `tasks` hang off
 * a project (`owner: 'project'`), `comments` hang off a task
 * (`owner: 'task'` → two-hop chain), and `docs` are owner-chained AND use a
 * custom routeKey. Before `owner` gained runtime semantics, tasks/comments/
 * docs were completely unscoped — an org-B user got org-A records on index
 * and every member endpoint.
 */
const cfg = {
  models: {
    projects: {
      model: 'project',
      policy: ProjectPolicy,
      belongsToOrganization: true,
      validation: z.object({ name: z.string().min(1) }),
    },
    tasks: {
      model: 'task',
      policy: TaskPolicy,
      owner: 'project',
      softDeletes: true,
      validation: z.object({ title: z.string().min(1) }),
    },
    comments: {
      model: 'comment',
      policy: CommentPolicy,
      owner: 'task',
      validation: z.object({ body: z.string().min(1) }),
    },
    docs: {
      model: 'doc',
      policy: DocPolicy,
      owner: 'project',
      routeKey: 'hashId',
      softDeletes: true,
      validation: z.object({ title: z.string().min(1) }),
    },
  },
};

const orgA = { id: 1, slug: 'org-a' };
const orgB = { id: 2, slug: 'org-b' };

function reqCtx(org: any | null, slugPerms = '*') {
  return {
    user: {
      id: 1,
      email: 'u@x.y',
      userRoles: [{ organizationId: org?.id ?? null, permissions: [slugPerms] }],
    },
    organization: org ?? undefined,
  } as any;
}

function seed() {
  return {
    project: [
      { id: 1, name: 'A-proj', organizationId: 1 },
      { id: 2, name: 'B-proj', organizationId: 2 },
    ],
    task: [
      { id: 1, title: 'a-task', projectId: 1, deletedAt: null },
      { id: 2, title: 'b-task', projectId: 2, deletedAt: null },
      { id: 3, title: 'a-trashed', projectId: 1, deletedAt: new Date('2026-01-01') },
      { id: 4, title: 'b-trashed', projectId: 2, deletedAt: new Date('2026-01-01') },
    ],
    comment: [
      { id: 1, body: 'on a-task', taskId: 1 },
      { id: 2, body: 'on b-task', taskId: 2 },
    ],
    doc: [
      { id: 1, hashId: 'doc-a', title: 'a-doc', projectId: 1, deletedAt: null },
      { id: 2, hashId: 'doc-b', title: 'b-doc', projectId: 2, deletedAt: null },
    ],
  };
}

async function expectNotFound(promise: Promise<any>) {
  let thrown: any;
  try {
    await promise;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(RhinoException);
  expect(thrown.getStatus()).toBe(404);
}

describe('owner-chain multi-tenancy (indirect tenant models, e2e)', () => {
  describe('index', () => {
    it('single-hop model (tasks): each org sees only its own rows', async () => {
      const env = buildEnv(cfg as any, seed());
      const a: any = await env.controllers.global.index('tasks', {}, reqCtx(orgA));
      const b: any = await env.controllers.global.index('tasks', {}, reqCtx(orgB));
      expect(a.items.map((r: any) => r.id)).toEqual([1]);
      expect(b.items.map((r: any) => r.id)).toEqual([2]);
    });

    it('two-hop model (comments): scoped through task → project', async () => {
      const env = buildEnv(cfg as any, seed());
      const a: any = await env.controllers.global.index('comments', {}, reqCtx(orgA));
      const b: any = await env.controllers.global.index('comments', {}, reqCtx(orgB));
      expect(a.items.map((r: any) => r.body)).toEqual(['on a-task']);
      expect(b.items.map((r: any) => r.body)).toEqual(['on b-task']);
    });

    it('pagination totals count only own-org rows', async () => {
      const env = buildEnv(cfg as any, seed());
      const a: any = await env.controllers.global.index('tasks', {}, reqCtx(orgA));
      expect(a.total).toBe(1); // not 2 live tasks across both orgs
    });

    it('direct org model (projects) stays scoped — sanity', async () => {
      const env = buildEnv(cfg as any, seed());
      const a: any = await env.controllers.global.index('projects', {}, reqCtx(orgA));
      expect(a.items.map((r: any) => r.name)).toEqual(['A-proj']);
    });

    it('no org context → controller path stays lenient (unscoped), unchanged behavior', async () => {
      const env = buildEnv(cfg as any, seed());
      const res: any = await env.controllers.global.index('tasks', {}, reqCtx(null));
      expect(res.items.map((r: any) => r.id).sort()).toEqual([1, 2]); // live rows, both orgs
    });
  });

  describe('show', () => {
    it('same-org works; cross-org is 404 (single- and two-hop)', async () => {
      const env = buildEnv(cfg as any, seed());
      const own: any = await env.controllers.global.show('tasks', '1', {}, reqCtx(orgA));
      expect(own.id).toBe(1);
      await expectNotFound(env.controllers.global.show('tasks', '1', {}, reqCtx(orgB)));
      await expectNotFound(env.controllers.global.show('comments', '1', {}, reqCtx(orgB)));
      const ownComment: any = await env.controllers.global.show('comments', '2', {}, reqCtx(orgB));
      expect(ownComment.id).toBe(2);
    });

    it('custom routeKey: cross-org by hash is 404, same-org resolves', async () => {
      const env = buildEnv(cfg as any, seed());
      const own: any = await env.controllers.global.show('docs', 'doc-a', {}, reqCtx(orgA));
      expect(own.hashId).toBe('doc-a');
      await expectNotFound(env.controllers.global.show('docs', 'doc-a', {}, reqCtx(orgB)));
    });
  });

  describe('update', () => {
    it('cross-org update is 404 and does not mutate the row', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(
        env.controllers.global.update('tasks', '1', { title: 'hacked' }, reqCtx(orgB)),
      );
      expect(env.client._data.task.find((r: any) => r.id === 1).title).toBe('a-task');
    });

    it('same-org update works (single- and two-hop, and by custom routeKey)', async () => {
      const env = buildEnv(cfg as any, seed());
      const t: any = await env.controllers.global.update('tasks', '1', { title: 'renamed' }, reqCtx(orgA));
      expect(t.title).toBe('renamed');
      const c: any = await env.controllers.global.update('comments', '2', { body: 'edited' }, reqCtx(orgB));
      expect(c.body).toBe('edited');
      const d: any = await env.controllers.global.update('docs', 'doc-a', { title: 'a-doc-2' }, reqCtx(orgA));
      expect(d.title).toBe('a-doc-2');
    });

    it('cross-org update by custom routeKey is 404', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(
        env.controllers.global.update('docs', 'doc-b', { title: 'hacked' }, reqCtx(orgA)),
      );
      expect(env.client._data.doc.find((r: any) => r.hashId === 'doc-b').title).toBe('b-doc');
    });
  });

  describe('destroy (soft delete)', () => {
    it('cross-org destroy is 404 and leaves the row live', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(env.controllers.global.destroy('tasks', '1', reqCtx(orgB)));
      expect(env.client._data.task.find((r: any) => r.id === 1).deletedAt).toBeNull();
    });

    it('same-org destroy soft-deletes; hard delete (comments) is org-scoped too', async () => {
      const env = buildEnv(cfg as any, seed());
      await env.controllers.global.destroy('tasks', '1', reqCtx(orgA));
      expect(env.client._data.task.find((r: any) => r.id === 1).deletedAt).toBeInstanceOf(Date);

      // comments has no softDeletes → deleteMany path with the nested filter.
      await expectNotFound(env.controllers.global.destroy('comments', '1', reqCtx(orgB)));
      expect(env.client._data.comment).toHaveLength(2);
      await env.controllers.global.destroy('comments', '1', reqCtx(orgA));
      expect(env.client._data.comment.map((r: any) => r.id)).toEqual([2]);
    });

    it('destroy by custom routeKey is org-scoped', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(env.controllers.global.destroy('docs', 'doc-b', reqCtx(orgA)));
      await env.controllers.global.destroy('docs', 'doc-a', reqCtx(orgA));
      expect(env.client._data.doc.find((r: any) => r.hashId === 'doc-a').deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('trashed / restore / force-delete', () => {
    it('trashed listing is scoped per org', async () => {
      const env = buildEnv(cfg as any, seed());
      const a: any = await env.controllers.global.trashed('tasks', {}, reqCtx(orgA));
      const b: any = await env.controllers.global.trashed('tasks', {}, reqCtx(orgB));
      expect(a.items.map((r: any) => r.id)).toEqual([3]);
      expect(b.items.map((r: any) => r.id)).toEqual([4]);
    });

    it('cross-org restore is 404; same-org restore revives the row', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(env.controllers.global.restore('tasks', '3', reqCtx(orgB)));
      expect(env.client._data.task.find((r: any) => r.id === 3).deletedAt).toBeInstanceOf(Date);
      const res: any = await env.controllers.global.restore('tasks', '3', reqCtx(orgA));
      expect(res).toEqual({ restored: true });
      expect(env.client._data.task.find((r: any) => r.id === 3).deletedAt).toBeNull();
    });

    it('cross-org force-delete is 404; same-org removes the row', async () => {
      const env = buildEnv(cfg as any, seed());
      await expectNotFound(env.controllers.global.forceDelete('tasks', '3', reqCtx(orgB)));
      expect(env.client._data.task.some((r: any) => r.id === 3)).toBe(true);
      await env.controllers.global.forceDelete('tasks', '3', reqCtx(orgA));
      expect(env.client._data.task.some((r: any) => r.id === 3)).toBe(false);
    });

    it('restore/force-delete by custom routeKey are org-scoped', async () => {
      const data = seed();
      data.doc.push({
        id: 3,
        hashId: 'doc-a-trash',
        title: 'a-doc-trashed',
        projectId: 1,
        deletedAt: new Date('2026-01-01') as any,
      });
      const env = buildEnv(cfg as any, data);
      await expectNotFound(env.controllers.global.restore('docs', 'doc-a-trash', reqCtx(orgB)));
      await env.controllers.global.restore('docs', 'doc-a-trash', reqCtx(orgA));
      expect(env.client._data.doc.find((r: any) => r.hashId === 'doc-a-trash').deletedAt).toBeNull();

      await env.controllers.global.destroy('docs', 'doc-a-trash', reqCtx(orgA));
      await expectNotFound(env.controllers.global.forceDelete('docs', 'doc-a-trash', reqCtx(orgB)));
      await env.controllers.global.forceDelete('docs', 'doc-a-trash', reqCtx(orgA));
      expect(env.client._data.doc.some((r: any) => r.hashId === 'doc-a-trash')).toBe(false);
    });
  });

  describe('regression: the pre-fix leak', () => {
    it('an org-B context can no longer read org-A rows on any endpoint of an owner model', async () => {
      const env = buildEnv(cfg as any, seed());
      const index: any = await env.controllers.global.index('tasks', {}, reqCtx(orgB));
      expect(index.items.some((r: any) => r.projectId === 1)).toBe(false);
      await expectNotFound(env.controllers.global.show('tasks', '1', {}, reqCtx(orgB)));
      await expectNotFound(env.controllers.global.update('tasks', '1', { title: 'x' }, reqCtx(orgB)));
      await expectNotFound(env.controllers.global.destroy('tasks', '1', reqCtx(orgB)));
      await expectNotFound(env.controllers.global.restore('tasks', '3', reqCtx(orgB)));
      await expectNotFound(env.controllers.global.forceDelete('tasks', '3', reqCtx(orgB)));
      // Nothing was mutated by any of the rejected calls.
      expect(env.client._data.task.find((r: any) => r.id === 1)).toMatchObject({
        title: 'a-task',
        deletedAt: null,
      });
    });
  });
});
