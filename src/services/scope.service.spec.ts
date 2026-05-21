import { ScopeService, RhinoScope } from './scope.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

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
