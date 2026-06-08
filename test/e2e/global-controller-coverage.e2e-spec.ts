import { z } from 'zod';
import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { AuditService } from '../../src/services/audit.service';

afterEach(() => jest.restoreAllMocks());

// Additional GlobalController coverage: the update/destroy/restore/forceDelete
// audit-trail branches, the update forbidden/validation/cross-tenant branches,
// the non-paginated trashed return, hard-delete (no org scope), and the
// action-disabled / not-found guards. No production code is changed.

function ctxUser(orgId = 1, perms = ['posts.*']) {
  return {
    user: { id: 1, email: 'a@b.c', userRoles: [{ organizationId: orgId, permissions: perms }] },
    organization: { id: orgId, slug: 'acme' },
  };
}

class PostPolicy extends ResourcePolicy {}
class NarrowUpdatePolicy extends ResourcePolicy {
  permittedAttributesForUpdate(): string[] {
    return ['title'];
  }
}

const tenantPost = (extra: Record<string, any> = {}) => ({
  model: 'post',
  policy: PostPolicy,
  belongsToOrganization: true,
  ...extra,
});

describe('GlobalController — coverage gaps', () => {
  // ── audit trail on every mutation ──────────────────────────────────

  it('update writes an "updated" audit entry when the diff is non-empty', async () => {
    // The in-memory mock returns the same row reference for `existing` and the
    // post-update fetch (real Prisma returns fresh snapshots), so force a
    // non-empty diff to exercise the audit-log branch.
    jest
      .spyOn(AuditService.prototype, 'diff')
      .mockReturnValue({ old: { title: 'a' }, new: { title: 'b' } });
    const env = buildEnv(
      { models: { posts: tenantPost({ hasAuditTrail: true, validation: z.object({ title: z.string().min(1) }) }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await env.controllers.global.update('posts', '1', { title: 'b' }, ctxUser() as any);
    const audit = env.client._data.auditLog ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ auditableType: 'post', action: 'updated' });
  });

  it('update does NOT audit when the diff is empty (nothing changed)', async () => {
    jest.spyOn(AuditService.prototype, 'diff').mockReturnValue(null);
    const env = buildEnv(
      { models: { posts: tenantPost({ hasAuditTrail: true, validation: z.object({ title: z.string().min(1) }) }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await env.controllers.global.update('posts', '1', { title: 'a' }, ctxUser() as any);
    expect(env.client._data.auditLog ?? []).toHaveLength(0);
  });

  it('destroy writes a "deleted" audit entry', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ hasAuditTrail: true }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await env.controllers.global.destroy('posts', '1', ctxUser() as any);
    const audit = env.client._data.auditLog ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ auditableType: 'post', action: 'deleted' });
  });

  it('restore writes a "restored" audit entry', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ softDeletes: true, hasAuditTrail: true }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1, deletedAt: new Date() }] },
    );
    await env.controllers.global.restore('posts', '1', ctxUser() as any);
    const audit = env.client._data.auditLog ?? [];
    expect(audit.map((a: any) => a.action)).toContain('restored');
  });

  it('forceDelete writes a "forceDeleted" audit entry and removes the row', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ softDeletes: true, hasAuditTrail: true }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1, deletedAt: new Date() }] },
    );
    await env.controllers.global.forceDelete('posts', '1', ctxUser() as any);
    expect(env.client._data.post).toHaveLength(0);
    const audit = env.client._data.auditLog ?? [];
    expect(audit.map((a: any) => a.action)).toContain('forceDeleted');
  });

  // ── update guards (mirror of the store guards) ─────────────────────

  it('update rejects forbidden fields with FORBIDDEN_FIELDS (403)', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ policy: NarrowUpdatePolicy, validation: z.object({ title: z.string().min(1) }) }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await expect(
      env.controllers.global.update('posts', '1', { title: 'b', budget: 1000 }, ctxUser() as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_FIELDS' });
  });

  it('update rejects invalid payload with VALIDATION_FAILED (422)', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ validation: z.object({ title: z.string().min(1) }) }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await expect(
      env.controllers.global.update('posts', '1', { title: '' }, ctxUser() as any),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('update rejects a cross-tenant foreign key with CROSS_TENANT (422)', async () => {
    const env = buildEnv(
      {
        models: {
          posts: tenantPost({
            validation: z.object({ title: z.string().min(1), projectId: z.number().optional() }),
            fkConstraints: [{ field: 'projectId', model: 'project' }],
          }),
          projects: { model: 'project', belongsToOrganization: true },
        },
      },
      { post: [{ id: 1, title: 'a', organizationId: 1 }], project: [{ id: 99, organizationId: 99 }] },
    );
    await expect(
      env.controllers.global.update('posts', '1', { title: 'x', projectId: 99 }, ctxUser() as any),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT' });
  });

  it('update of a missing record is NOT_FOUND (404)', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ validation: z.object({ title: z.string().min(1) }) }) } },
      { post: [] },
    );
    await expect(
      env.controllers.global.update('posts', '999', { title: 'x' }, ctxUser() as any),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── trashed: non-paginated return path ─────────────────────────────

  it('trashed returns a bare { data } envelope when pagination is disabled', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost({ softDeletes: true, paginationEnabled: false }) } },
      { post: [{ id: 1, title: 'a', organizationId: 1, deletedAt: new Date() }] },
    );
    const res: any = await env.controllers.global.trashed('posts', {}, ctxUser() as any);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.__rhinoPaginated).toBeUndefined();
  });

  // ── action-disabled guards ─────────────────────────────────────────

  it('trashed is disabled when softDeletes is off', async () => {
    const env = buildEnv({ models: { posts: tenantPost() } }, { post: [] });
    await expect(
      env.controllers.global.trashed('posts', {}, ctxUser() as any),
    ).rejects.toMatchObject({ code: expect.any(String) });
  });

  it('forceDelete is disabled when softDeletes is off', async () => {
    const env = buildEnv(
      { models: { posts: tenantPost() } },
      { post: [{ id: 1, title: 'a', organizationId: 1 }] },
    );
    await expect(
      env.controllers.global.forceDelete('posts', '1', ctxUser() as any),
    ).rejects.toMatchObject({ code: expect.any(String) });
  });

  // ── hard delete with no org scope (resource.service else-branch) ───

  it('destroy hard-deletes a non-tenant model (no org scope)', async () => {
    const env = buildEnv(
      { models: { notes: { model: 'note' } } },
      { note: [{ id: 1, title: 'a' }] },
    );
    await env.controllers.global.destroy('notes', '1', { user: { id: 1, userRoles: [{ permissions: ['notes.*'] }] } } as any);
    expect(env.client._data.note).toHaveLength(0);
  });
});
