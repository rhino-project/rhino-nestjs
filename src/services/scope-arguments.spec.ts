import { QueryBuilderService } from './query-builder.service';
import { ScopeService, RhinoNamedScope, ScopeContext } from './scope.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

class ArchivedScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return { status: 'archived' };
  }
}

class SinceScope implements RhinoNamedScope {
  static params = ['date'];
  apply(ctx: ScopeContext): Record<string, any> {
    return { createdAt: { gte: ctx.args?.date } };
  }
}

class WindowScope implements RhinoNamedScope {
  static params = ['from', 'to'];
  apply(ctx: ScopeContext): Record<string, any> {
    return { createdAt: { gte: ctx.args?.from, lte: ctx.args?.to } };
  }
}

class TitledScope implements RhinoNamedScope {
  static params = ['title', 'status'];
  static optionalParams = ['status'];
  apply(ctx: ScopeContext): Record<string, any> {
    const where: Record<string, any> = { title: ctx.args?.title };
    if (ctx.args?.status !== undefined) where.status = ctx.args.status;
    return where;
  }
}

class PublishedIsScope implements RhinoNamedScope {
  static params = ['flag'];
  apply(ctx: ScopeContext): Record<string, any> {
    return { published: ctx.args?.flag };
  }
}

class RestrictivePolicy {
  permittedScopes(): string[] {
    return ['archived'];
  }
}

const reg: ModelRegistration = {
  model: 'post',
  allowedFilters: ['status'],
  allowedSorts: ['title'],
  namedScopes: {
    archived: ArchivedScope,
    since: SinceScope,
    window: WindowScope,
    titled: TitledScope,
    publishedIs: PublishedIsScope,
  },
};

describe('Named scope arguments', () => {
  let qb: QueryBuilderService;

  beforeEach(() => {
    qb = new QueryBuilderService();
  });

  describe('backward compatibility', () => {
    it('still accepts the legacy ?scope=name form', () => {
      const q = qb.build({ scope: 'archived' }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'archived', args: {} }]);
      expect(q.scopeName).toBe('archived');
    });

    it('accepts the bracket form with an empty value', () => {
      const q = qb.build({ scope: { archived: '' } }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'archived', args: {} }]);
    });

    it('applies the default scope when no scope is sent', () => {
      const q = qb.build({}, { ...reg, defaultScope: 'archived' }, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'archived', args: {} }]);
    });
  });

  describe('arguments', () => {
    it('binds a bare value to the single declared parameter', () => {
      const q = qb.build({ scope: { since: '2026-01-01' } }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'since', args: { date: '2026-01-01' } }]);
    });

    it('binds named arguments whatever order they arrive in', () => {
      const q = qb.build({ scope: { window: { to: 'b', from: 'a' } } }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'window', args: { from: 'a', to: 'b' } }]);
    });

    it('allows an optional parameter to be omitted', () => {
      const q = qb.build({ scope: { titled: { title: 'x' } } }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'titled', args: { title: 'x' } }]);
    });

    it('coerces "false" to a real boolean', () => {
      const q = qb.build({ scope: { publishedIs: 'false' } }, reg, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'publishedIs', args: { flag: false } }]);
    });
  });

  describe('argument errors', () => {
    const cases: Array<[string, any, string]> = [
      ['unknown parameter', { window: { from: 'a', to: 'b', nope: 'c' } }, "Scope 'window' does not accept parameter 'nope'"],
      ['missing required parameter', { window: { from: 'a' } }, "Scope 'window' requires parameter 'to'"],
      ['bare value for a multi-parameter scope', { window: 'a,b' }, "Scope 'window' requires named parameters"],
      ['positional list', { window: ['a', 'b'] }, "Scope 'window' requires named parameters"],
      ['arguments to a scope with none', { archived: 'yesterday' }, "Scope 'archived' does not accept arguments"],
    ];

    it.each(cases)('rejects %s', (_label, scope, message) => {
      expect(() => qb.build({ scope }, reg, { namedScopes: true })).toThrow(message);
    });

    it('rejects the legacy form for a scope with required parameters', () => {
      expect(() => qb.build({ scope: 'window' }, reg, { namedScopes: true })).toThrow(
        "Scope 'window' requires parameter 'from'",
      );
    });
  });

  describe('composition', () => {
    it('keeps the order the URL listed', () => {
      const q = qb.build({ scope: { archived: '', since: '2026-01-01' } }, reg, {
        namedScopes: true,
      });
      expect(q.scopes?.map((s) => s.name)).toEqual(['archived', 'since']);
    });

    it('refuses more than three scopes', () => {
      const scope = {
        archived: '',
        since: '2026-01-01',
        publishedIs: 'true',
        window: { from: 'a', to: 'b' },
      };
      expect(() => qb.build({ scope }, reg, { namedScopes: true })).toThrow('Too many scopes requested');
    });
  });

  describe('the scope cap', () => {
    const withCap = (cap: any) =>
      new QueryBuilderService({ maxScopesPerRequest: () => cap } as any);

    it('is configurable', () => {
      const qb2 = withCap(2);
      const ok = qb2.build({ scope: { archived: '', since: '2026-01-01' } }, reg, {
        namedScopes: true,
      });
      expect(ok.scopes).toHaveLength(2);

      expect(() =>
        qb2.build({ scope: { archived: '', since: '2026-01-01', publishedIs: 'true' } }, reg, {
          namedScopes: true,
        }),
      ).toThrow('Too many scopes requested');
    });

    it('defaults to three when no config is injected', () => {
      const three = qb.build(
        { scope: { archived: '', since: '2026-01-01', publishedIs: 'true' } },
        reg,
        { namedScopes: true },
      );
      expect(three.scopes).toHaveLength(3);
    });
  });

  describe('dependency injection', () => {
    // A circular import between rhino.config and query-builder.service once left
    // RhinoConfigService undefined while the decorators ran, so Nest injected
    // nothing and every app silently kept the default cap.
    // ts-jest resolves the cycle that the compiled CommonJS output does not, so
    // this guards the actual failure mode: the import itself.
    it('keeps rhino.config from importing the query builder', async () => {
      const { readFileSync } = await import('fs');
      const source = readFileSync(`${__dirname}/../rhino.config.ts`, 'utf8');
      expect(source).not.toMatch(/from '\.\/services\/query-builder\.service'/);
    });

    it('receives the config service through the module, so the cap is honored', async () => {
      const { Test } = await import('@nestjs/testing');
      const { RhinoModule } = await import('../rhino.module');

      const moduleRef = await Test.createTestingModule({
        imports: [
          RhinoModule.forRoot(
            { models: { posts: { model: 'post' } }, maxScopesPerRequest: 5 } as any,
            { registerControllers: false },
          ),
        ],
      }).compile();

      const injected = moduleRef.get(QueryBuilderService);
      expect((injected as any).config).toBeDefined();
      expect((injected as any).maxScopesPerRequest()).toBe(5);
    });
  });

  describe('permittedScopes', () => {
    const gated: ModelRegistration = { ...reg, policy: RestrictivePolicy as any };

    it('refuses a declared scope the policy does not permit', () => {
      expect(() => qb.build({ scope: { since: '2026-01-01' } }, gated, { namedScopes: true })).toThrow(
        "Scope 'since' is not allowed",
      );
    });

    it('still runs a scope the policy permits', () => {
      const q = qb.build({ scope: 'archived' }, gated, { namedScopes: true });
      expect(q.scopes).toEqual([{ name: 'archived', args: {} }]);
    });

    it('refuses an undeclared scope with the same message', () => {
      expect(() => qb.build({ scope: { secret: '' } }, reg, { namedScopes: true })).toThrow(
        "Scope 'secret' is not allowed",
      );
    });

    it('refuses a prototype key', () => {
      expect(() => qb.build({ scope: 'constructor' }, reg, { namedScopes: true })).toThrow(
        "Scope 'constructor' is not allowed",
      );
    });
  });

  describe('ScopeService', () => {
    it('hands the bound arguments to the scope', () => {
      const scopes = new ScopeService();
      const where = scopes.applyNamed('window', { deletedAt: null }, reg, {
        args: { from: 'a', to: 'b' },
      });
      expect(where).toEqual({
        AND: [{ deletedAt: null }, { createdAt: { gte: 'a', lte: 'b' } }],
      });
    });
  });
});
