import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';
import type { RhinoNamedScope, ScopeContext } from '../../src/services/scope.service';
import type {
  CollectionComputedContext,
  RhinoConfig,
} from '../../src/interfaces/rhino-config.interface';

// --------------------------------------------------------------------------
// Counter — proves laziness (nothing is evaluated unless it was asked for)
// --------------------------------------------------------------------------

const calls: Record<string, number> = {};
const hit = (name: string) => {
  calls[name] = (calls[name] ?? 0) + 1;
};
const count = (name: string) => calls[name] ?? 0;
const resetCalls = () => Object.keys(calls).forEach((k) => delete calls[k]);

// --------------------------------------------------------------------------
// Policies
// --------------------------------------------------------------------------

class UserPolicy extends ResourcePolicy {}

class BlacklistPolicy extends ResourcePolicy {
  override hiddenAttributesForShow(): string[] {
    return ['secretNote', 'secretTotal'];
  }
}

class WhitelistPolicy extends ResourcePolicy {
  override permittedAttributesForShow(): string[] {
    return ['id', 'status', 'firstName', 'fullName', 'activeUsersCount'];
  }
}

class DenyViewAnyPolicy extends ResourcePolicy {
  override viewAny(): boolean {
    return false;
  }
}

class OwnedScope implements RhinoNamedScope {
  apply(ctx: ScopeContext): Record<string, any> {
    if (!ctx.user) return { id: { in: [] } };
    return { ownerId: ctx.user.id };
  }
}

// --------------------------------------------------------------------------
// Declarations
// --------------------------------------------------------------------------

const recordComputedAttributes = {
  fullName: (record: any) => {
    hit('fullName');
    return `${record.firstName} ${record.lastName}`.trim();
  },
  expensiveFlag: (record: any) => {
    hit('expensiveFlag');
    return record.status === 'active';
  },
  viewerId: (_record: any, user: any) => user?.id ?? null,
  secretNote: () => 'classified',
  literal: 'not-a-callable' as any,
};

const collectionComputedAttributes = {
  activeUsersCount: (ctx: CollectionComputedContext) => {
    hit('activeUsersCount');
    return ctx.delegate.count({ where: { ...ctx.where, status: 'active' } });
  },
  blockedUsersCount: (ctx: CollectionComputedContext) => {
    hit('blockedUsersCount');
    return ctx.delegate.count({ where: { ...ctx.where, status: 'blocked' } });
  },
  totalCount: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
  viewerId: (ctx: CollectionComputedContext) => ctx.user?.id ?? null,
  secretTotal: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
};

function cfg(overrides: Record<string, any> = {}): RhinoConfig {
  return {
    models: {
      users: {
        model: 'user',
        policy: UserPolicy,
        belongsToOrganization: true,
        // Default off so index returns the plain `{ data: [...] }` envelope;
        // the pagination case overrides it explicitly below.
        paginationEnabled: false,
        allowedFilters: ['ownerId', 'status'],
        allowedSearch: ['firstName'],
        namedScopes: { owned: OwnedScope },
        recordComputedAttributes,
        collectionComputedAttributes,
        ...overrides,
      },
    },
  } as RhinoConfig;
}

/** A model that declares nothing at all. */
const plainCfg: RhinoConfig = {
  models: {
    plains: { model: 'user', policy: UserPolicy, belongsToOrganization: true, paginationEnabled: false },
  },
} as RhinoConfig;

function seed() {
  return {
    user: [
      { id: 1, firstName: 'Ada', lastName: 'Lovelace', status: 'active', ownerId: 1, organizationId: 1 },
      { id: 2, firstName: 'Alan', lastName: 'Turing', status: 'active', ownerId: 1, organizationId: 1 },
      { id: 3, firstName: 'Grace', lastName: 'Hopper', status: 'active', ownerId: 2, organizationId: 1 },
      { id: 4, firstName: 'Mal', lastName: 'Ware', status: 'blocked', ownerId: 2, organizationId: 1 },
      { id: 5, firstName: 'Pat', lastName: 'Ending', status: 'pending', ownerId: 1, organizationId: 1 },
      // other org — must never leak into an aggregate
      { id: 6, firstName: 'Other', lastName: 'Org', status: 'active', ownerId: 1, organizationId: 2 },
    ],
  };
}

function ctxUser(userId = 1, orgId = 1, perms = ['*']) {
  return {
    user: {
      id: userId,
      email: `${userId}@b.c`,
      userRoles: [{ organizationId: orgId, permissions: perms }],
    },
    organization: { id: orgId, slug: `org${orgId}` },
  };
}

async function capture(fn: () => Promise<any>) {
  try {
    return { result: await fn(), error: undefined as any };
  } catch (error) {
    return { result: undefined as any, error };
  }
}

// --------------------------------------------------------------------------
// INDIRECT (owner-chain) tenancy — the leak class fixed in 4.6.1. The framework
// must hand the callable a `where` already scoped through the ownership chain.
// --------------------------------------------------------------------------

class ProjectPolicy extends ResourcePolicy {}
class TaskPolicy extends ResourcePolicy {}
class CommentPolicy extends ResourcePolicy {}

const ownerChainCfg = {
  models: {
    projects: { model: 'project', policy: ProjectPolicy, belongsToOrganization: true, paginationEnabled: false },
    // one hop: task -> project -> organization
    tasks: {
      model: 'task',
      policy: TaskPolicy,
      owner: 'project',
      paginationEnabled: false,
      recordComputedAttributes: { shoutyTitle: (r: any) => String(r.title).toUpperCase() },
      collectionComputedAttributes: {
        totalCount: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
        openCount: (ctx: CollectionComputedContext) =>
          ctx.delegate.count({ where: { ...ctx.where, status: 'open' } }),
      },
    },
    // two hops: comment -> task -> project -> organization
    comments: {
      model: 'comment',
      policy: CommentPolicy,
      owner: 'task',
      paginationEnabled: false,
      recordComputedAttributes: { shoutyBody: (r: any) => String(r.body).toUpperCase() },
      collectionComputedAttributes: {
        totalCount: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
      },
    },
  },
} as unknown as RhinoConfig;

/** org1 gets 2 tasks (1 open) + 1 comment; org2 gets 3 tasks (2 open) + 2 comments. */
function ownerChainSeed() {
  return {
    project: [
      { id: 1, name: 'A-proj', organizationId: 1 },
      { id: 2, name: 'B-proj', organizationId: 2 },
    ],
    task: [
      { id: 1, title: 'a one', status: 'open', projectId: 1 },
      { id: 2, title: 'a two', status: 'done', projectId: 1 },
      { id: 3, title: 'b one', status: 'open', projectId: 2 },
      { id: 4, title: 'b two', status: 'open', projectId: 2 },
      { id: 5, title: 'b three', status: 'done', projectId: 2 },
    ],
    comment: [
      { id: 1, body: 'a comment', taskId: 1 },
      { id: 2, body: 'b comment', taskId: 3 },
      { id: 3, body: 'b comment two', taskId: 4 },
    ],
  };
}

describe('Computed attributes', () => {
  beforeEach(() => resetCalls());

  // ======================================================================
  // COLLECTION-LEVEL: GET /{resource}/computed?attributes=
  // ======================================================================

  describe('GET /computed', () => {
    it('returns the selected aggregates', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'activeUsersCount,blockedUsersCount' },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { activeUsersCount: 3, blockedUsersCount: 1 } });
    });

    it('evaluates each attribute exactly once for the whole collection', async () => {
      const env = buildEnv(cfg(), seed());
      await env.controllers.global.computed('users', { attributes: 'activeUsersCount' }, ctxUser() as any);
      expect(count('activeUsersCount')).toBe(1);
      expect(count('blockedUsersCount')).toBe(0);
    });

    it('returns every permitted attribute when ?attributes is omitted', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed('users', {}, ctxUser() as any);
      expect(Object.keys(res.data)).toEqual([
        'activeUsersCount',
        'blockedUsersCount',
        'totalCount',
        'viewerId',
        'secretTotal',
      ]);
    });

    it('treats a blank ?attributes as omitted', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed('users', { attributes: '' }, ctxUser() as any);
      expect(Object.keys(res.data)).toHaveLength(5);
    });

    it('isolates each callable from the others', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'activeUsersCount,blockedUsersCount,totalCount' },
        ctxUser() as any,
      );
      expect(res.data).toEqual({ activeUsersCount: 3, blockedUsersCount: 1, totalCount: 5 });
    });

    it('passes the current user to the callable', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'viewerId' },
        ctxUser(7) as any,
      );
      expect(res.data.viewerId).toBe(7);
    });

    it('ignores blank segments and duplicates', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: ' activeUsersCount , ,activeUsersCount ' },
        ctxUser() as any,
      );
      expect(res.data).toEqual({ activeUsersCount: 3 });
      expect(count('activeUsersCount')).toBe(1);
    });

    it('respects ?filter[]', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount', filter: { ownerId: 1 } },
        ctxUser() as any,
      );
      expect(res.data.totalCount).toBe(3);
    });

    it('respects ?search', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount', search: 'Alan' },
        ctxUser() as any,
      );
      expect(res.data.totalCount).toBe(1);
    });

    it('respects ?scope', async () => {
      const env = buildEnv(cfg(), seed());
      const scoped: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount', scope: 'owned' },
        ctxUser(2) as any,
      );
      const unscoped: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount' },
        ctxUser(2) as any,
      );
      expect(scoped.data.totalCount).toBe(2);
      expect(unscoped.data.totalCount).toBe(5);
    });

    it('rejects a scope that is not whitelisted', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'totalCount', scope: 'nope' }, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe("Scope 'nope' is not allowed");
    });

    it('never counts another organization rows', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount,activeUsersCount' },
        ctxUser(1, 1) as any,
      );
      // org 2 has one extra active row (id 6) that must not be counted.
      expect(res.data).toEqual({ totalCount: 5, activeUsersCount: 3 });
    });

    it('scopes aggregates to the requesting organization', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount' },
        ctxUser(1, 2) as any,
      );
      expect(res.data.totalCount).toBe(1);
    });

    it('excludes soft-deleted rows when the model has soft deletes', async () => {
      const data = seed();
      (data.user[0] as any).deletedAt = new Date();
      const env = buildEnv(cfg({ softDeletes: true }), data);
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount' },
        ctxUser() as any,
      );
      expect(res.data.totalCount).toBe(4);
    });

    it('rejects an undeclared attribute with 403', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'activeUsersCount,nope' }, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe(
        "Computed attribute 'nope' is not allowed",
      );
    });

    it('rejects a prototype key rather than invoking it', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'constructor' }, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('rejects a non-string ?attributes param', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: ['activeUsersCount'] }, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe(
        'Computed attributes are not allowed',
      );
    });

    it('404s for a model that declares no collection attributes', async () => {
      const env = buildEnv(plainCfg, seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('plains', {}, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(404);
    });

    it('404s for an empty declaration', async () => {
      const env = buildEnv(cfg({ collectionComputedAttributes: {} }), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', {}, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(404);
    });

    it('honours exceptActions', async () => {
      const env = buildEnv(cfg({ exceptActions: ['computed'] }), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', {}, ctxUser() as any),
      );
      expect(error).toBeInstanceOf(RhinoException);
      expect((error as RhinoException).getStatus()).toBe(404);
    });
  });

  // ======================================================================
  // COLLECTION-LEVEL: policy gating
  // ======================================================================

  describe('GET /computed policy gating', () => {
    it('rejects a blacklisted attribute', async () => {
      const env = buildEnv(cfg({ policy: BlacklistPolicy }), seed());
      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'secretTotal' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe(
        "Computed attribute 'secretTotal' is not allowed",
      );
    });

    it('omits a blacklisted attribute when ?attributes is omitted', async () => {
      const env = buildEnv(cfg({ policy: BlacklistPolicy }), seed());
      const res: any = await env.controllers.global.computed('users', {}, ctxUser() as any);
      expect(res.data).not.toHaveProperty('secretTotal');
      expect(res.data).toHaveProperty('activeUsersCount');
    });

    it('rejects an attribute outside the whitelist', async () => {
      const env = buildEnv(cfg({ policy: WhitelistPolicy }), seed());
      const ok: any = await env.controllers.global.computed(
        'users',
        { attributes: 'activeUsersCount' },
        ctxUser() as any,
      );
      expect(ok.data.activeUsersCount).toBe(3);

      const { error } = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'blockedUsersCount' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('returns only whitelisted attributes when ?attributes is omitted', async () => {
      const env = buildEnv(cfg({ policy: WhitelistPolicy }), seed());
      const res: any = await env.controllers.global.computed('users', {}, ctxUser() as any);
      expect(res.data).toEqual({ activeUsersCount: 3 });
    });

    it('gives the same error for unknown and denied names', async () => {
      const env = buildEnv(cfg({ policy: WhitelistPolicy }), seed());
      const denied = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'blockedUsersCount' }, ctxUser() as any),
      );
      const unknown = await capture(() =>
        env.controllers.global.computed('users', { attributes: 'blockedUsersCountTypo' }, ctxUser() as any),
      );
      expect((denied.error as RhinoException).getStatus()).toBe(403);
      expect((unknown.error as RhinoException).getStatus()).toBe(403);
      expect(((denied.error as RhinoException).getResponse() as any).message).toContain('is not allowed');
      expect(((unknown.error as RhinoException).getResponse() as any).message).toContain('is not allowed');
    });
  });

  // ======================================================================
  // RECORD-LEVEL: ?computed_attributes= on index / show / trashed
  // ======================================================================

  describe('?computed_attributes= on index', () => {
    it('omits opt-in attributes by default', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index('users', {}, ctxUser() as any);
      expect(res.data[0]).not.toHaveProperty('fullName');
      expect(res.data[0]).not.toHaveProperty('expensiveFlag');
    });

    it('never evaluates opt-in attributes by default', async () => {
      const env = buildEnv(cfg(), seed());
      await env.controllers.global.index('users', {}, ctxUser() as any);
      expect(count('fullName')).toBe(0);
      expect(count('expensiveFlag')).toBe(0);
    });

    it('includes only the requested attributes', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
      expect(res.data[0]).not.toHaveProperty('expensiveFlag');
      expect(count('fullName')).toBe(5);
      expect(count('expensiveFlag')).toBe(0);
    });

    it('supports multiple attributes', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName,expensiveFlag' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
      expect(res.data[0].expensiveFlag).toBe(true);
    });

    it('passes the current user to the callable', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'viewerId' },
        ctxUser(9) as any,
      );
      expect(res.data[0].viewerId).toBe(9);
    });

    it('returns non-callable declarations verbatim', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'literal' },
        ctxUser() as any,
      );
      expect(res.data[0].literal).toBe('not-a-callable');
    });

    it('accepts the camelCase param spelling too', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computedAttributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
    });

    it('rejects an undeclared attribute with 403', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: 'fullName,madeUp' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe(
        "Computed attribute 'madeUp' is not allowed",
      );
    });

    it('rejects a prototype key rather than invoking it', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: 'constructor' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('rejects a non-string param', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: ['fullName'] }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
      expect(((error as RhinoException).getResponse() as any).message).toBe(
        'Computed attributes are not allowed',
      );
    });

    it('treats a blank param as none', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: '' },
        ctxUser() as any,
      );
      expect(res.data[0]).not.toHaveProperty('fullName');
    });

    it('rejects any selection on a model that declares nothing', async () => {
      const env = buildEnv(plainCfg, seed());
      const ok: any = await env.controllers.global.index('plains', {}, ctxUser() as any);
      expect(ok.data).toHaveLength(5);

      const { error } = await capture(() =>
        env.controllers.global.index('plains', { computed_attributes: 'fullName' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('only evaluates the rows actually returned under pagination', async () => {
      const env = buildEnv(cfg({ paginationEnabled: true, perPage: 2 }), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.items).toHaveLength(2);
      expect(count('fullName')).toBe(2);
    });

    it('combines with filters', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName', filter: { status: 'blocked' } },
        ctxUser() as any,
      );
      expect(res.data).toHaveLength(1);
      expect(res.data[0].fullName).toBe('Mal Ware');
    });

    it('combines with a named scope', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName', scope: 'owned' },
        ctxUser(2) as any,
      );
      expect(res.data).toHaveLength(2);
      expect(res.data[0]).toHaveProperty('fullName');
    });
  });

  describe('?computed_attributes= on show', () => {
    it('includes the requested attribute', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.show(
        'users',
        '2',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.fullName).toBe('Alan Turing');
    });

    it('omits opt-in attributes by default', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.show('users', '2', {}, ctxUser() as any);
      expect(res).not.toHaveProperty('fullName');
    });

    it('rejects an undeclared attribute with 403', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.show('users', '2', { computed_attributes: 'madeUp' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });
  });

  describe('?computed_attributes= on trashed', () => {
    it('includes the requested attribute', async () => {
      const data = seed();
      (data.user[0] as any).deletedAt = new Date();
      const env = buildEnv(cfg({ softDeletes: true }), data);
      const res: any = await env.controllers.global.trashed(
        'users',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
    });

    it('rejects an undeclared attribute with 403', async () => {
      const env = buildEnv(cfg({ softDeletes: true }), seed());
      const { error } = await capture(() =>
        env.controllers.global.trashed('users', { computed_attributes: 'madeUp' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });
  });

  // ======================================================================
  // RECORD-LEVEL: policy gating
  // ======================================================================

  describe('?computed_attributes= policy gating', () => {
    it('rejects a blacklisted attribute', async () => {
      const env = buildEnv(cfg({ policy: BlacklistPolicy }), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: 'secretNote' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('allows a non-blacklisted attribute', async () => {
      const env = buildEnv(cfg({ policy: BlacklistPolicy }), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
    });

    it('rejects an attribute outside the whitelist', async () => {
      const env = buildEnv(cfg({ policy: WhitelistPolicy }), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: 'expensiveFlag' }, ctxUser() as any),
      );
      expect((error as RhinoException).getStatus()).toBe(403);
    });

    it('keeps a whitelisted attribute through serialization', async () => {
      const env = buildEnv(cfg({ policy: WhitelistPolicy }), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
      // The whitelist still strips everything it does not name.
      expect(res.data[0]).not.toHaveProperty('lastName');
    });
  });

  // ======================================================================
  // INDIRECT (owner-chain) TENANCY
  // ======================================================================

  describe('owner-chain tenancy', () => {
    it('scopes one-hop aggregates through the ownership chain', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const a: any = await env.controllers.global.computed(
        'tasks',
        { attributes: 'totalCount,openCount' },
        ctxUser(1, 1) as any,
      );
      const b: any = await env.controllers.global.computed(
        'tasks',
        { attributes: 'totalCount,openCount' },
        ctxUser(1, 2) as any,
      );
      // 5 tasks exist; each org may only count the ones under its own project.
      expect(a.data).toEqual({ totalCount: 2, openCount: 1 });
      expect(b.data).toEqual({ totalCount: 3, openCount: 2 });
    });

    it('scopes two-hop aggregates through comment → task → project', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const a: any = await env.controllers.global.computed(
        'comments',
        { attributes: 'totalCount' },
        ctxUser(1, 1) as any,
      );
      const b: any = await env.controllers.global.computed(
        'comments',
        { attributes: 'totalCount' },
        ctxUser(1, 2) as any,
      );
      expect(a.data.totalCount).toBe(1);
      expect(b.data.totalCount).toBe(2);
    });

    it('matches what index returns for the same org', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const index: any = await env.controllers.global.index('tasks', {}, ctxUser(1, 1) as any);
      const computed: any = await env.controllers.global.computed(
        'tasks',
        { attributes: 'totalCount' },
        ctxUser(1, 1) as any,
      );
      expect(computed.data.totalCount).toBe(index.data.length);
    });

    it('never exposes another org rows through ?computed_attributes=', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const res: any = await env.controllers.global.index(
        'tasks',
        { computed_attributes: 'shoutyTitle' },
        ctxUser(1, 1) as any,
      );
      expect(res.data.map((r: any) => r.shoutyTitle).sort()).toEqual(['A ONE', 'A TWO']);
    });

    it('never exposes another org rows through a two-hop ?computed_attributes=', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const res: any = await env.controllers.global.index(
        'comments',
        { computed_attributes: 'shoutyBody' },
        ctxUser(1, 2) as any,
      );
      expect(res.data.map((r: any) => r.shoutyBody).sort()).toEqual(['B COMMENT', 'B COMMENT TWO']);
    });
  });

  // ======================================================================
  // POLICY GUARD ACTION RESOLUTION
  // ======================================================================

  describe('policy guard', () => {
    it('maps GET /computed to the viewAny gate', async () => {
      const { ResourcePolicyGuard } = await import('../../src/guards/resource-policy.guard');
      const env = buildEnv(cfg({ policy: DenyViewAnyPolicy }), seed());
      const guard = new ResourcePolicyGuard(env.config);

      const req: any = {
        method: 'GET',
        url: '/api/users/computed',
        params: { modelSlug: 'users' },
        user: ctxUser().user,
        organization: ctxUser().organization,
      };
      const context: any = { switchToHttp: () => ({ getRequest: () => req }) };

      expect(() => guard.canActivate(context)).toThrow(RhinoException);
    });

    it('allows GET /computed when viewAny passes and tags the action', async () => {
      const { ResourcePolicyGuard } = await import('../../src/guards/resource-policy.guard');
      const env = buildEnv(cfg(), seed());
      const guard = new ResourcePolicyGuard(env.config);

      const req: any = {
        method: 'GET',
        url: '/api/users/computed',
        params: { modelSlug: 'users' },
        user: ctxUser().user,
        organization: ctxUser().organization,
      };
      const context: any = { switchToHttp: () => ({ getRequest: () => req }) };

      expect(guard.canActivate(context)).toBe(true);
      expect(req.__action).toBe('computed');
    });
  });
});
