/**
 * Configurable route key — member endpoints (show/update/destroy/restore/
 * force-delete) match the `:id` URL segment against `routeKey` instead of the
 * primary key: `GET /api/jobs/{hash_id}`.
 *
 * Resolution: `models[slug].routeKey ?? config.routeKey ?? 'id'`. The default
 * path (nothing configured) is byte-identical to the legacy PK behavior —
 * covered by the whole existing suite.
 */
import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';

function ctxUser(orgId = 1, perms = ['jobs.*']) {
  return {
    user: { id: 1, email: 'a@b.c', userRoles: [{ organizationId: orgId, permissions: perms }] },
    organization: { id: orgId, slug: 'acme' },
  } as any;
}

class JobPolicy extends ResourcePolicy {}

/** Whitelist policy — must never strip the route-key column. */
class WhitelistJobPolicy extends ResourcePolicy {
  permittedAttributesForShow(): string[] {
    return ['title'];
  }
}

const baseCfg = {
  models: {
    jobs: {
      model: 'job',
      policy: JobPolicy,
      routeKey: 'hashId',
      belongsToOrganization: true,
      softDeletes: true,
      hasAuditTrail: true,
      validation: z.object({ title: z.string().min(1) }),
      allowedFields: ['id', 'hashId', 'title', 'status'],
    },
  },
};

const rows = () => [
  { id: 1, hashId: 'h-alpha', title: 'first', organizationId: 1, deletedAt: null },
  { id: 2, hashId: '48291', title: 'digit-hash', organizationId: 1, deletedAt: null },
  { id: 3, hashId: 'h-other-org', title: 'foreign', organizationId: 2, deletedAt: null },
  { id: 4, hashId: 'h-trashed', title: 'binned', organizationId: 1, deletedAt: new Date() },
];

describe('Configurable route key (e2e)', () => {
  // -------------------------------------------------------------------------
  // show
  // -------------------------------------------------------------------------

  it('show resolves the record by its hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    const res: any = await env.controllers.global.show('jobs', 'h-alpha', {}, ctxUser());
    expect(res).toMatchObject({ id: 1, hashId: 'h-alpha', title: 'first' });
  });

  it('show treats a digit-only hash as a string (no numification)', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    const res: any = await env.controllers.global.show('jobs', '48291', {}, ctxUser());
    expect(res).toMatchObject({ id: 2, hashId: '48291' });
  });

  it('show by primary-key value no longer matches (404)', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.show('jobs', '1', {}, ctxUser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('show with an unknown hash is 404', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.show('jobs', 'h-nope', {}, ctxUser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a valid hash belonging to another organization is 404 (no cross-tenant leak)', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.show('jobs', 'h-other-org', {}, ctxUser(1)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  it('update mutates the record addressed by hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    const res: any = await env.controllers.global.update(
      'jobs',
      'h-alpha',
      { title: 'renamed' },
      ctxUser(),
    );
    expect(res).toMatchObject({ id: 1, hashId: 'h-alpha', title: 'renamed' });
    expect(env.client._data.job.find((r: any) => r.id === 1).title).toBe('renamed');
  });

  it('update via hash from another org is 404', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.update('jobs', 'h-other-org', { title: 'x' }, ctxUser(1)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(env.client._data.job.find((r: any) => r.id === 3).title).toBe('foreign');
  });

  // -------------------------------------------------------------------------
  // destroy / restore / force-delete (soft deletes)
  // -------------------------------------------------------------------------

  it('destroy soft-deletes the record addressed by hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await env.controllers.global.destroy('jobs', 'h-alpha', ctxUser());
    expect(env.client._data.job.find((r: any) => r.id === 1).deletedAt).toBeInstanceOf(Date);
  });

  it('restore brings back a trashed record addressed by hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    const res: any = await env.controllers.global.restore('jobs', 'h-trashed', ctxUser());
    expect(res).toEqual({ restored: true });
    expect(env.client._data.job.find((r: any) => r.id === 4).deletedAt).toBeNull();
  });

  it('restore with an unknown hash is 404', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.restore('jobs', 'h-nope', ctxUser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('force-delete permanently removes the record addressed by hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await env.controllers.global.forceDelete('jobs', 'h-trashed', ctxUser());
    expect(env.client._data.job.find((r: any) => r.id === 4)).toBeUndefined();
  });

  it('force-delete via hash from another org is 404', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await expect(
      env.controllers.global.forceDelete('jobs', 'h-other-org', ctxUser(1)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(env.client._data.job.find((r: any) => r.id === 3)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Audit bugfix: restore logs the record's REAL primary key, not the raw
  // route param (previously the raw `:id` segment leaked into auditableId).
  // -------------------------------------------------------------------------

  it('audit row for restore records the primary key id, not the hash', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await env.controllers.global.restore('jobs', 'h-trashed', ctxUser());
    const entries = env.client._data.auditLog ?? [];
    const restored = entries.find((e: any) => e.action === 'restored');
    expect(restored).toBeDefined();
    expect(restored.auditableId).toBe(4);
  });

  it('audit rows for update/destroy also record the primary key id', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    await env.controllers.global.update('jobs', 'h-alpha', { title: 'x' }, ctxUser());
    await env.controllers.global.destroy('jobs', 'h-alpha', ctxUser());
    const entries = env.client._data.auditLog ?? [];
    for (const e of entries) expect(e.auditableId).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Serialization / field selection keep the route-key column reachable
  // -------------------------------------------------------------------------

  it('a policy whitelist keeps the route-key column in the payload', async () => {
    const cfg = {
      models: {
        jobs: { ...baseCfg.models.jobs, policy: WhitelistJobPolicy },
      },
    };
    const env = buildEnv(cfg, { job: rows() });
    const res: any = await env.controllers.global.show('jobs', 'h-alpha', {}, ctxUser());
    expect(res).toEqual({ id: 1, hashId: 'h-alpha', title: 'first' });
  });

  it('?fields responses still include the route-key column', async () => {
    const env = buildEnv(baseCfg, { job: rows() });
    const res: any = await env.controllers.global.index(
      'jobs',
      { fields: { jobs: 'title' } },
      ctxUser(),
    );
    // Whichever envelope shape, every serialized row keeps id + hashId.
    const items = res.items ?? res.data;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.hashId).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Precedence: per-model beats global; global applies when the model is
  // silent; nothing set = legacy PK behavior.
  // -------------------------------------------------------------------------

  it('global routeKey applies to models without their own; per-model wins', async () => {
    const cfg = {
      routeKey: 'uuid',
      models: {
        jobs: { model: 'job', policy: JobPolicy, routeKey: 'hashId' },
        tickets: { model: 'ticket', policy: JobPolicy },
      },
    };
    const env = buildEnv(cfg, {
      job: [{ id: 1, hashId: 'h-1', uuid: 'u-job', title: 'by-hash' }],
      ticket: [{ id: 1, uuid: 'u-ticket', title: 'by-uuid' }],
    });
    const byHash: any = await env.controllers.global.show('jobs', 'h-1', {}, ctxUser());
    expect(byHash).toMatchObject({ title: 'by-hash' });
    // the per-model key shadows the global one entirely
    await expect(
      env.controllers.global.show('jobs', 'u-job', {}, ctxUser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const byUuid: any = await env.controllers.global.show('tickets', 'u-ticket', {}, ctxUser());
    expect(byUuid).toMatchObject({ title: 'by-uuid' });
    await expect(
      env.controllers.global.show('tickets', '1', {}, ctxUser()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a model without any routeKey keeps legacy primary-key routing', async () => {
    const cfg = { models: { posts: { model: 'post', policy: JobPolicy } } };
    const env = buildEnv(cfg, { post: [{ id: 7, title: 'plain' }] });
    const res: any = await env.controllers.global.show('posts', '7', {}, ctxUser());
    expect(res).toMatchObject({ id: 7, title: 'plain' });
  });

  // -------------------------------------------------------------------------
  // Non-org-scoped mutate paths (findFirst-then-mutate-by-PK branch)
  // -------------------------------------------------------------------------

  it('update and hard destroy work by hash without an organization context', async () => {
    const cfg = {
      models: {
        jobs: { model: 'job', policy: JobPolicy, routeKey: 'hashId' },
      },
    };
    const env = buildEnv(cfg, {
      job: [{ id: 5, hashId: 'h-free', title: 'standalone' }],
    });
    const req = { user: ctxUser().user } as any; // no organization
    const updated: any = await env.controllers.global.update(
      'jobs',
      'h-free',
      { title: 'edited' },
      req,
    );
    expect(updated).toMatchObject({ id: 5, title: 'edited' });
    await env.controllers.global.destroy('jobs', 'h-free', req);
    expect(env.client._data.job).toHaveLength(0);
  });
});
