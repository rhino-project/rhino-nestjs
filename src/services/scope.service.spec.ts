import { ScopeService, RhinoScope, RhinoNamedScope, ScopeContext } from './scope.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { RhinoException } from '../errors/rhino-exception';

class LimitToOwnerScope implements RhinoScope {
  apply(where: Record<string, any>, ctx: any) {
    if (ctx.userRole === 'member') {
      return { ...where, assignedTo: ctx.user.id };
    }
    return where;
  }
}

class ActiveOnlyScope implements RhinoScope {
  apply(where: Record<string, any>) {
    return { ...where, isActive: true };
  }
}

describe('ScopeService', () => {
  it('applies no scopes when model has none registered', () => {
    const svc = new ScopeService();
    const reg: ModelRegistration = { model: 'post' };
    expect(svc.apply({ a: 1 }, reg, {})).toEqual({ a: 1 });
  });

  it('applies a single scope', () => {
    const svc = new ScopeService();
    const reg: ModelRegistration = { model: 'post', scopes: [ActiveOnlyScope] };
    expect(svc.apply({ a: 1 }, reg, {})).toEqual({ a: 1, isActive: true });
  });

  it('applies scopes in order, composing the where', () => {
    const svc = new ScopeService();
    const reg: ModelRegistration = {
      model: 'task',
      scopes: [ActiveOnlyScope, LimitToOwnerScope],
    };
    const out = svc.apply({}, reg, { user: { id: 9 }, userRole: 'member' });
    expect(out).toEqual({ isActive: true, assignedTo: 9 });
  });

  it('scope can return falsy/undefined without breaking', () => {
    class NoopScope implements RhinoScope {
      apply() {
        return undefined as any;
      }
    }
    const svc = new ScopeService();
    const reg: ModelRegistration = { model: 'x', scopes: [NoopScope] };
    expect(svc.apply({ a: 1 }, reg, {})).toEqual({ a: 1 });
  });
});

class ActiveNamedScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return { status: 'active' };
  }
}

class OwnerNamedScope implements RhinoNamedScope {
  apply(ctx: ScopeContext): Record<string, any> {
    if (!ctx.user) return { id: { in: [] } };
    return { ownerId: ctx.user.id };
  }
}

class EmptyFragmentScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return undefined as any;
  }
}

describe('ScopeService.applyNamed', () => {
  const svc = new ScopeService();

  function expectForbidden(fn: () => void, message?: string) {
    let thrown: any;
    try {
      fn();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RhinoException);
    expect(thrown.getStatus()).toBe(403);
    expect(thrown.code).toBe('FORBIDDEN');
    if (message) expect((thrown.getResponse() as any).message).toBe(message);
  }

  it('AND-wraps the fragment with the incoming where', () => {
    const reg: ModelRegistration = { model: 'route', namedScopes: { active: ActiveNamedScope } };
    const where = { organizationId: 1 };
    const out = svc.applyNamed('active', where, reg, {});
    expect(out).toEqual({ AND: [{ organizationId: 1 }, { status: 'active' }] });
  });

  it('passes the context to the scope body (current user reachable)', () => {
    const reg: ModelRegistration = { model: 'route', namedScopes: { owner: OwnerNamedScope } };
    const out = svc.applyNamed('owner', { organizationId: 1 }, reg, { user: { id: 42 } });
    expect(out).toEqual({ AND: [{ organizationId: 1 }, { ownerId: 42 }] });
  });

  it('returns the where unchanged when the scope produces an empty fragment', () => {
    const reg: ModelRegistration = { model: 'route', namedScopes: { noop: EmptyFragmentScope } };
    const where = { organizationId: 1 };
    expect(svc.applyNamed('noop', where, reg, {})).toBe(where);
  });

  it('throws forbidden for an unknown / non-whitelisted name', () => {
    const reg: ModelRegistration = { model: 'route', namedScopes: { active: ActiveNamedScope } };
    expectForbidden(() => svc.applyNamed('secret', {}, reg, {}), "Scope 'secret' is not allowed");
  });

  it('throws forbidden when the model declares no namedScopes at all', () => {
    const reg: ModelRegistration = { model: 'route' };
    expectForbidden(() => svc.applyNamed('active', {}, reg, {}), "Scope 'active' is not allowed");
  });

  it('throws forbidden for prototype keys (constructor, hasOwnProperty, toString)', () => {
    const reg: ModelRegistration = { model: 'route', namedScopes: { active: ActiveNamedScope } };
    for (const key of ['constructor', 'hasOwnProperty', 'toString', '__proto__']) {
      expectForbidden(() => svc.applyNamed(key, {}, reg, {}), `Scope '${key}' is not allowed`);
    }
  });

  it('throws forbidden when the resolved class has no apply method', () => {
    class NoApply {}
    const reg: ModelRegistration = {
      model: 'route',
      namedScopes: { broken: NoApply as any },
    };
    expectForbidden(() => svc.applyNamed('broken', {}, reg, {}), "Scope 'broken' is not allowed");
  });
});
