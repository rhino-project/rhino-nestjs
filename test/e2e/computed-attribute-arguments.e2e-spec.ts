import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';
import { RhinoException } from '../../src/errors/rhino-exception';
import type {
  CollectionComputedContext,
  RhinoConfig,
} from '../../src/interfaces/rhino-config.interface';

// --------------------------------------------------------------------------
// Policies
// --------------------------------------------------------------------------

class UserPolicy extends ResourcePolicy {}

class DenySecretPolicy extends ResourcePolicy {
  override hiddenAttributesForShow(): string[] {
    return ['secretLabel', 'secretTotal'];
  }
}

// --------------------------------------------------------------------------
// Declarations — mixes legacy callables, legacy literals and extended specs
// --------------------------------------------------------------------------

const recordComputedAttributes = {
  // Legacy: unchanged behavior.
  fullName: (record: any) => `${record.firstName} ${record.lastName}`.trim(),
  literalVersion: 3 as any,
  literalTags: ['a', 'b'] as any,

  // Extended.
  labelSince: {
    params: ['since'],
    using: (record: any, _user: any, args: any) => `${record.firstName}@${args.since}`,
  },
  labelWindow: {
    params: ['from', 'to'],
    using: (_record: any, _user: any, args: any) => `${args.from}..${args.to}`,
  },
  labelOptional: {
    params: ['prefix', 'suffix'],
    optionalParams: ['suffix'],
    using: (_record: any, _user: any, args: any) => `${args.prefix}${args.suffix ?? '!'}`,
  },
  labelAllOptional: {
    params: ['tone'],
    optionalParams: ['tone'],
    using: (_record: any, _user: any, args: any) => `tone:${args.tone ?? 'plain'}`,
  },
  labelFlag: {
    params: ['on'],
    using: (_record: any, _user: any, args: any) =>
      typeof args.on === 'boolean' ? `bool:${args.on}` : `string:${args.on}`,
  },
  secretLabel: {
    params: ['since'],
    using: (_record: any, _user: any, args: any) => `classified-${args.since}`,
  },
};

const collectionComputedAttributes = {
  totalCount: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
  literalVersion: 3 as any,

  statusCount: {
    params: ['status'],
    using: (ctx: CollectionComputedContext) =>
      ctx.delegate.count({ where: { ...ctx.where, status: ctx.args!.status } }),
  },
  rangeCount: {
    params: ['min', 'max'],
    // `in` rather than gte/lte: the mock Prisma delegate in test/helpers
    // implements `in` but not range operators. The binding is what is under
    // test here, not the Prisma filter vocabulary.
    using: (ctx: CollectionComputedContext) => {
      const min = Number(ctx.args!.min);
      const max = Number(ctx.args!.max);
      const ids = [];
      for (let i = min; i <= max; i += 1) ids.push(i);
      return ctx.delegate.count({ where: { ...ctx.where, id: { in: ids } } });
    },
  },
  optionalCount: {
    params: ['status'],
    optionalParams: ['status'],
    using: (ctx: CollectionComputedContext) =>
      ctx.args!.status === undefined
        ? ctx.delegate.count({ where: ctx.where })
        : ctx.delegate.count({ where: { ...ctx.where, status: ctx.args!.status } }),
  },
  flagEcho: {
    params: ['on'],
    using: (ctx: CollectionComputedContext) =>
      typeof ctx.args!.on === 'boolean' ? `bool:${ctx.args!.on}` : `string:${ctx.args!.on}`,
  },
  secretTotal: {
    params: ['status'],
    using: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
  },
};

/** Every declaration is legacy — the backward-compatibility lock. */
const legacyRecordComputedAttributes = {
  fullName: (record: any) => `${record.firstName} ${record.lastName}`.trim(),
  version: 3 as any,
  tags: ['a', 'b'] as any,
  meta: { color: 'red' } as any,
};

const legacyCollectionComputedAttributes = {
  totalCount: (ctx: CollectionComputedContext) => ctx.delegate.count({ where: ctx.where }),
  version: 3 as any,
  tags: ['a', 'b'] as any,
  meta: { color: 'red' } as any,
};

function cfg(overrides: Record<string, any> = {}): RhinoConfig {
  return {
    models: {
      users: {
        model: 'user',
        policy: UserPolicy,
        belongsToOrganization: true,
        paginationEnabled: false,
        allowedFilters: ['status'],
        recordComputedAttributes,
        collectionComputedAttributes,
        ...overrides,
      },
    },
  } as RhinoConfig;
}

const legacyCfg: RhinoConfig = {
  models: {
    users: {
      model: 'user',
      policy: UserPolicy,
      belongsToOrganization: true,
      paginationEnabled: false,
      recordComputedAttributes: legacyRecordComputedAttributes,
      collectionComputedAttributes: legacyCollectionComputedAttributes,
    },
  },
} as unknown as RhinoConfig;

function seed() {
  return {
    user: [
      { id: 1, firstName: 'Ada', lastName: 'Lovelace', status: 'active', organizationId: 1 },
      { id: 2, firstName: 'Alan', lastName: 'Turing', status: 'active', organizationId: 1 },
      { id: 3, firstName: 'Mal', lastName: 'Ware', status: 'blocked', organizationId: 1 },
      { id: 4, firstName: 'Pat', lastName: 'Ending', status: 'pending', organizationId: 1 },
      // other org — must never leak into an aggregate
      { id: 5, firstName: 'Other', lastName: 'Org', status: 'active', organizationId: 2 },
      { id: 6, firstName: 'Ada', lastName: 'Clone', status: 'active', organizationId: 2 },
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

function expectForbidden(error: any, message: string) {
  expect(error).toBeInstanceOf(RhinoException);
  expect((error as RhinoException).getStatus()).toBe(403);
  expect(((error as RhinoException).getResponse() as any).message).toBe(message);
}

// --------------------------------------------------------------------------
// INDIRECT (owner-chain) tenancy — the historical leak site.
// --------------------------------------------------------------------------

class ProjectPolicy extends ResourcePolicy {}
class TaskPolicy extends ResourcePolicy {}
class CommentPolicy extends ResourcePolicy {}

const ownerChainCfg = {
  models: {
    projects: {
      model: 'project',
      policy: ProjectPolicy,
      belongsToOrganization: true,
      paginationEnabled: false,
    },
    // two hops: comment -> task -> project -> organization
    comments: {
      model: 'comment',
      policy: CommentPolicy,
      owner: 'task',
      paginationEnabled: false,
      recordComputedAttributes: {
        taggedBody: {
          params: ['tag'],
          using: (record: any, _user: any, args: any) => `${args.tag}:${record.body}`,
        },
      },
      collectionComputedAttributes: {
        // Naming a task that belongs to ANOTHER org's project must count zero:
        // the owner-chain scope is already on ctx.where.
        taskProbeCount: {
          params: ['taskId'],
          using: (ctx: CollectionComputedContext) =>
            ctx.delegate.count({ where: { ...ctx.where, taskId: Number(ctx.args!.taskId) } }),
        },
      },
    },
    tasks: { model: 'task', policy: TaskPolicy, owner: 'project', paginationEnabled: false },
  },
} as unknown as RhinoConfig;

/** org1 gets 2 comments on task 1; org2 gets 2 comments on task 3. */
function ownerChainSeed() {
  return {
    project: [
      { id: 1, name: 'A-proj', organizationId: 1 },
      { id: 2, name: 'B-proj', organizationId: 2 },
    ],
    task: [
      { id: 1, title: 'a one', status: 'open', projectId: 1 },
      { id: 3, title: 'b one', status: 'open', projectId: 2 },
    ],
    comment: [
      { id: 1, body: 'mine a', taskId: 1 },
      { id: 2, body: 'mine b', taskId: 1 },
      { id: 3, body: 'theirs a', taskId: 3 },
      { id: 4, body: 'theirs b', taskId: 3 },
    ],
  };
}

describe('Computed attribute arguments', () => {
  // ======================================================================
  // /computed — the four wire forms
  // ======================================================================

  describe('GET /computed wire forms', () => {
    it('form A: the legacy comma list is unchanged', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount,literalVersion' },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { totalCount: 4, literalVersion: 3 } });
    });

    it('form B: a bracket key with no arguments', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: { totalCount: '' } },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { totalCount: 4 } });
    });

    it('form C: a bare value binds the single declared parameter', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: { statusCount: 'active' } },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { statusCount: 2 } });
    });

    it('form D: named arguments', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: { rangeCount: { min: '1', max: '2' } } },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { rangeCount: 2 } });
    });

    it('binds named arguments by name, not by position', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: { rangeCount: { max: '3', min: '2' } } },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { rangeCount: 2 } });
    });

    it('combines forms B, C and D in one request', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        {
          attributes: {
            totalCount: '',
            statusCount: 'blocked',
            rangeCount: { min: '1', max: '4' },
          },
        },
        ctxUser() as any,
      );
      expect(res).toEqual({ data: { totalCount: 4, statusCount: 1, rangeCount: 4 } });
    });

    it('lets an optional parameter be omitted', async () => {
      const env = buildEnv(cfg(), seed());
      const omitted: any = await env.controllers.global.computed(
        'users',
        { attributes: { optionalCount: '' } },
        ctxUser() as any,
      );
      const given: any = await env.controllers.global.computed(
        'users',
        { attributes: { optionalCount: 'active' } },
        ctxUser() as any,
      );
      expect(omitted.data.optionalCount).toBe(4);
      expect(given.data.optionalCount).toBe(2);
    });

    it('hands the callable real booleans for "true" and "false"', async () => {
      const env = buildEnv(cfg(), seed());
      const t: any = await env.controllers.global.computed(
        'users',
        { attributes: { flagEcho: 'true' } },
        ctxUser() as any,
      );
      const f: any = await env.controllers.global.computed(
        'users',
        { attributes: { flagEcho: 'FALSE' } },
        ctxUser() as any,
      );
      const s: any = await env.controllers.global.computed(
        'users',
        { attributes: { flagEcho: 'yes' } },
        ctxUser() as any,
      );
      expect(t.data.flagEcho).toBe('bool:true');
      expect(f.data.flagEcho).toBe('bool:false');
      expect(s.data.flagEcho).toBe('string:yes');
    });

    it('gives each parameterised callable its own copy of the scoped where', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: { statusCount: 'active', totalCount: '' } },
        ctxUser() as any,
      );
      expect(res.data).toEqual({ statusCount: 2, totalCount: 4 });
    });
  });

  // ======================================================================
  // /computed — the 403 contract, verbatim
  // ======================================================================

  describe('GET /computed 403 contract', () => {
    const run = (attributes: any, config: RhinoConfig = cfg()) => {
      const env = buildEnv(config, seed());
      return capture(() => env.controllers.global.computed('users', { attributes }, ctxUser() as any));
    };

    it('refuses an undeclared attribute named in the bracket form', async () => {
      const { error } = await run({ nope: { x: '1' } });
      expectForbidden(error, "Computed attribute 'nope' is not allowed");
    });

    it('gives a policy-denied attribute the same string as an undeclared one', async () => {
      const denied = await run({ secretTotal: 'active' }, cfg({ policy: DenySecretPolicy }));
      const undeclared = await run({ ghostTotal: 'active' }, cfg({ policy: DenySecretPolicy }));
      expectForbidden(denied.error, "Computed attribute 'secretTotal' is not allowed");
      expectForbidden(undeclared.error, "Computed attribute 'ghostTotal' is not allowed");
    });

    it('runs the gate BEFORE argument binding', async () => {
      // A denied attribute given a BAD argument must still return the gate
      // message: the specific argument errors must leak nothing.
      const { error } = await run({ secretTotal: { bogus: '1' } }, cfg({ policy: DenySecretPolicy }));
      expectForbidden(error, "Computed attribute 'secretTotal' is not allowed");
    });

    it('names a missing required parameter', async () => {
      const { error } = await run({ rangeCount: { min: '1' } });
      expectForbidden(error, "Computed attribute 'rangeCount' requires parameter 'max'");
    });

    it('names a required parameter left out of the bracket form entirely', async () => {
      const { error } = await run({ statusCount: '' });
      expectForbidden(error, "Computed attribute 'statusCount' requires parameter 'status'");
    });

    it('names a required parameter left out of the legacy list form', async () => {
      const { error } = await run('statusCount');
      expectForbidden(error, "Computed attribute 'statusCount' requires parameter 'status'");
    });

    it('names an unknown parameter', async () => {
      const { error } = await run({ statusCount: { nope: '1' } });
      expectForbidden(error, "Computed attribute 'statusCount' does not accept parameter 'nope'");
    });

    it('refuses a bare value for a multi-parameter attribute', async () => {
      const { error } = await run({ rangeCount: '1' });
      expectForbidden(error, "Computed attribute 'rangeCount' requires named parameters");
    });

    it('refuses a positional argument list', async () => {
      const { error } = await run({ rangeCount: ['1'] });
      expectForbidden(error, "Computed attribute 'rangeCount' requires named parameters");
    });

    it('refuses a nested argument value', async () => {
      const { error } = await run({ rangeCount: { min: { deep: '1' } } });
      expectForbidden(error, "Computed attribute 'rangeCount' requires named parameters");
    });

    it('refuses any argument sent to a parameterless attribute', async () => {
      const bare = await run({ totalCount: '5' });
      const named = await run({ totalCount: { x: '5' } });
      expectForbidden(bare.error, "Computed attribute 'totalCount' does not accept arguments");
      expectForbidden(named.error, "Computed attribute 'totalCount' does not accept arguments");
    });

    it('refuses a positional attribute list structurally', async () => {
      const { error } = await run(['totalCount']);
      expectForbidden(error, 'Computed attributes are not allowed');
    });

    it('refuses a blank attribute key structurally', async () => {
      const { error } = await run({ '': '1' });
      expectForbidden(error, 'Computed attributes are not allowed');
    });

    it('refuses a prototype attribute key in the bracket form', async () => {
      // `qs` strips these before the controller, so this is only reachable at
      // the service level — but the own-key lookup must hold regardless.
      const ctor = await run({ constructor: '' });
      expectForbidden(ctor.error, "Computed attribute 'constructor' is not allowed");

      // JSON.parse creates a REAL own `__proto__` key, so the own-key lookup is
      // what stops it resolving to Object.prototype.
      const proto = await run(JSON.parse('{"__proto__": ""}'));
      expectForbidden(proto.error, "Computed attribute '__proto__' is not allowed");
    });
  });

  // ======================================================================
  // /computed — the bare-call skip rule
  // ======================================================================

  describe('a bare GET /computed', () => {
    it('skips required-parameter attributes instead of 403ing', async () => {
      const env = buildEnv(cfg({ policy: DenySecretPolicy }), seed());
      const res: any = await env.controllers.global.computed('users', {}, ctxUser() as any);

      // totalCount and literalVersion take nothing; optionalCount's only
      // parameter is optional. statusCount / rangeCount / flagEcho declare a
      // required parameter and are skipped. secretTotal is policy-hidden.
      expect(Object.keys(res.data)).toEqual(['totalCount', 'literalVersion', 'optionalCount']);
      expect(res.data.optionalCount).toBe(4);
    });

    it('treats a blank ?attributes the same way', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.computed(
        'users',
        { attributes: '' },
        ctxUser() as any,
      );
      expect(Object.keys(res.data)).toContain('optionalCount');
      expect(Object.keys(res.data)).not.toContain('statusCount');
      expect(Object.keys(res.data)).not.toContain('rangeCount');
    });
  });

  // ======================================================================
  // index / show / trashed — ?computed_attributes=
  // ======================================================================

  describe('record-level attributes', () => {
    it('accepts a bare bracket argument on index', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelSince: '2026-01-01' } },
        ctxUser() as any,
      );
      expect(res.data[0].labelSince).toBe('Ada@2026-01-01');
    });

    it('accepts named arguments on index', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelWindow: { from: 'a', to: 'b' } } },
        ctxUser() as any,
      );
      expect(res.data[0].labelWindow).toBe('a..b');
    });

    it('accepts the camelCase param spelling in the bracket form too', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computedAttributes: { labelSince: '2026-01-01' } },
        ctxUser() as any,
      );
      expect(res.data[0].labelSince).toBe('Ada@2026-01-01');
    });

    it('combines legacy and parameterised attributes in one request', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { fullName: '', labelSince: '2026-01-01' } },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
      expect(res.data[0].labelSince).toBe('Ada@2026-01-01');
    });

    it('omits an omitted optional argument so the callable default applies', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelOptional: { prefix: 'hi' } } },
        ctxUser() as any,
      );
      expect(res.data[0].labelOptional).toBe('hi!');
    });

    it('binds a given optional argument', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelOptional: { prefix: 'hi', suffix: '?' } } },
        ctxUser() as any,
      );
      expect(res.data[0].labelOptional).toBe('hi?');
    });

    it('evaluates an all-optional attribute named in the legacy list form', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'labelAllOptional' },
        ctxUser() as any,
      );
      expect(res.data[0].labelAllOptional).toBe('tone:plain');
    });

    it('coerces booleans', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelFlag: 'TRUE' } },
        ctxUser() as any,
      );
      expect(res.data[0].labelFlag).toBe('bool:true');
    });

    it('accepts bracket arguments on show', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.show(
        'users',
        '2',
        { computed_attributes: { labelSince: '2026-02-02' } },
        ctxUser() as any,
      );
      expect(res.labelSince ?? res.data?.labelSince).toBe('Alan@2026-02-02');
    });

    it('accepts bracket arguments on trashed', async () => {
      const data = seed();
      (data.user[2] as any).deletedAt = new Date();
      const env = buildEnv(cfg({ softDeletes: true }), data);
      const res: any = await env.controllers.global.trashed(
        'users',
        { computed_attributes: { labelSince: '2026-03-03' } },
        ctxUser() as any,
      );
      // The mock delegate does not implement `deletedAt: { not: null }`, so the
      // trashed filter itself is asserted elsewhere; what matters here is that
      // the bracket argument reached the callable on the trashed path.
      const mal = res.data.find((r: any) => r.firstName === 'Mal');
      expect(mal.labelSince).toBe('Mal@2026-03-03');
    });

    it('runs the gate before argument binding on index', async () => {
      const env = buildEnv(cfg({ policy: DenySecretPolicy }), seed());
      const { error } = await capture(() =>
        env.controllers.global.index(
          'users',
          { computed_attributes: { secretLabel: { bogus: '1' } } },
          ctxUser() as any,
        ),
      );
      expectForbidden(error, "Computed attribute 'secretLabel' is not allowed");
    });

    it('reports a missing required argument on index', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index(
          'users',
          { computed_attributes: 'labelWindow' },
          ctxUser() as any,
        ),
      );
      expectForbidden(error, "Computed attribute 'labelWindow' requires parameter 'from'");
    });

    it('refuses a positional attribute list on index', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index('users', { computed_attributes: ['fullName'] }, ctxUser() as any),
      );
      expectForbidden(error, 'Computed attributes are not allowed');
    });

    it('refuses an unknown parameter on show', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.show(
          'users',
          '1',
          { computed_attributes: { labelSince: { nope: 'x' } } },
          ctxUser() as any,
        ),
      );
      expectForbidden(error, "Computed attribute 'labelSince' does not accept parameter 'nope'");
    });

    it('refuses a prototype attribute key in the bracket form', async () => {
      const env = buildEnv(cfg(), seed());
      const { error } = await capture(() =>
        env.controllers.global.index(
          'users',
          { computed_attributes: { constructor: '' } },
          ctxUser() as any,
        ),
      );
      expectForbidden(error, "Computed attribute 'constructor' is not allowed");
    });
  });

  // ======================================================================
  // Backward-compatibility lock — an all-legacy model
  // ======================================================================

  describe('an all-legacy model', () => {
    it('returns byte-identical aggregates bare and by name', async () => {
      const env = buildEnv(legacyCfg, seed());
      const bare: any = await env.controllers.global.computed('users', {}, ctxUser() as any);
      const named: any = await env.controllers.global.computed(
        'users',
        { attributes: 'totalCount,version,tags,meta' },
        ctxUser() as any,
      );
      const expected = { totalCount: 4, version: 3, tags: ['a', 'b'], meta: { color: 'red' } };
      expect(bare.data).toEqual(expected);
      expect(named.data).toEqual(expected);
    });

    it('keeps legacy record declarations byte-identical', async () => {
      const env = buildEnv(legacyCfg, seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: 'fullName,version,tags,meta' },
        ctxUser() as any,
      );
      expect(res.data[0].fullName).toBe('Ada Lovelace');
      expect(res.data[0].version).toBe(3);
      expect(res.data[0].tags).toEqual(['a', 'b']);
      expect(res.data[0].meta).toEqual({ color: 'red' });
    });

    it('evaluates nothing when the parameter is absent', async () => {
      const env = buildEnv(legacyCfg, seed());
      const res: any = await env.controllers.global.index('users', {}, ctxUser() as any);
      expect(res.data[0]).not.toHaveProperty('fullName');
      expect(res.data[0]).not.toHaveProperty('version');
    });
  });

  // ======================================================================
  // Direct serializer calls — names only, no arguments channel
  // ======================================================================

  describe('direct serializeOne calls', () => {
    it('skips required-parameter attributes rather than calling them with nothing', () => {
      const env = buildEnv(cfg(), seed());
      const reg = env.config.model('users')!;
      const record = { id: 1, firstName: 'Ada', lastName: 'Lovelace', status: 'active' };

      const json = env.serializer.serializeOne(record, reg, {
        user: null,
        computedAttributes: ['fullName', 'labelSince', 'labelOptional', 'labelAllOptional'],
      })!;

      expect(json.fullName).toBe('Ada Lovelace');
      expect(json).not.toHaveProperty('labelSince');
      expect(json).not.toHaveProperty('labelOptional');
      expect(json.labelAllOptional).toBe('tone:plain');
    });

    it('accepts an arguments channel', () => {
      const env = buildEnv(cfg(), seed());
      const reg = env.config.model('users')!;
      const record = { id: 1, firstName: 'Ada', lastName: 'Lovelace', status: 'active' };

      const json = env.serializer.serializeOne(record, reg, {
        user: null,
        computedAttributes: ['labelSince'],
        computedAttributeArgs: { labelSince: { since: '2026-01-01' } },
      })!;

      expect(json.labelSince).toBe('Ada@2026-01-01');
    });

    it('still applies the policy blacklist to a parameterised attribute', () => {
      const env = buildEnv(cfg({ policy: DenySecretPolicy }), seed());
      const reg = env.config.model('users')!;
      const record = { id: 1, firstName: 'Ada', lastName: 'Lovelace', status: 'active' };

      const json = env.serializer.serializeOne(record, reg, {
        user: null,
        computedAttributes: ['secretLabel'],
        computedAttributeArgs: { secretLabel: { since: '2026-01-01' } },
      })!;

      // Merged before the blacklist, so the blacklist still removes it.
      expect(json).not.toHaveProperty('secretLabel');
    });
  });

  // ======================================================================
  // Multi-tenancy — direct and indirect ownership
  // ======================================================================

  describe('multi-tenancy (direct organizationId)', () => {
    it('scopes a parameterised aggregate to the current org', async () => {
      const env = buildEnv(cfg(), seed());
      const org1: any = await env.controllers.global.computed(
        'users',
        { attributes: { statusCount: 'active' } },
        ctxUser(1, 1) as any,
      );
      const org2: any = await env.controllers.global.computed(
        'users',
        { attributes: { statusCount: 'active' } },
        ctxUser(1, 2) as any,
      );
      expect(org1.data.statusCount).toBe(2);
      expect(org2.data.statusCount).toBe(2);
    });

    it('never surfaces another org through a parameterised record attribute', async () => {
      const env = buildEnv(cfg(), seed());
      const res: any = await env.controllers.global.index(
        'users',
        { computed_attributes: { labelSince: '2026-01-01' } },
        ctxUser(1, 1) as any,
      );
      expect(res.data.map((r: any) => r.labelSince)).toEqual([
        'Ada@2026-01-01',
        'Alan@2026-01-01',
        'Mal@2026-01-01',
        'Pat@2026-01-01',
      ]);
    });
  });

  describe('multi-tenancy (indirect owner chain)', () => {
    it('scopes a parameterised aggregate through the ownership chain', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const mine: any = await env.controllers.global.computed(
        'comments',
        { attributes: { taskProbeCount: '1' } },
        ctxUser(1, 1) as any,
      );
      const theirs: any = await env.controllers.global.computed(
        'comments',
        { attributes: { taskProbeCount: '3' } },
        ctxUser(1, 1) as any,
      );
      expect(mine.data.taskProbeCount).toBe(2);
      // Task 3 belongs to org 2's project: unreachable from org 1.
      expect(theirs.data.taskProbeCount).toBe(0);
    });

    it('scopes a parameterised record attribute through the ownership chain', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const res: any = await env.controllers.global.index(
        'comments',
        { computed_attributes: { taggedBody: 'x' } },
        ctxUser(1, 1) as any,
      );
      expect(res.data.map((r: any) => r.taggedBody).sort()).toEqual(['x:mine a', 'x:mine b']);
    });

    it('does not change which rows index returns', async () => {
      const env = buildEnv(ownerChainCfg, ownerChainSeed());
      const plain: any = await env.controllers.global.index('comments', {}, ctxUser(1, 1) as any);
      const withArgs: any = await env.controllers.global.index(
        'comments',
        { computed_attributes: { taggedBody: 'x' } },
        ctxUser(1, 1) as any,
      );
      expect(withArgs.data).toHaveLength(plain.data.length);
    });
  });
});
