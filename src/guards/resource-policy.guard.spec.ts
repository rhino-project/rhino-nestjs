import { RhinoException } from '../errors/rhino-exception';
import { ResourcePolicyGuard } from './resource-policy.guard';
import { ResourcePolicy } from '../policies/resource-policy';
import { RhinoConfigService } from '../rhino.config';
import { RHINO_CONFIG } from '../constants/tokens';
import { normalizeConfig } from '../rhino.config';

function makeCtx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('ResourcePolicyGuard', () => {
  const user = {
    id: 1,
    userRoles: [{ organizationId: 1, permissions: ['posts.*'] }],
  };
  const org = { id: 1 };

  function makeGuard(cfg: any) {
    const config = new RhinoConfigService(normalizeConfig(cfg));
    return new ResourcePolicyGuard(config);
  }

  it('returns true when no modelSlug in params', () => {
    const guard = makeGuard({ models: {} });
    expect(guard.canActivate(makeCtx({ method: 'GET', url: '/auth/login', params: {} }))).toBe(true);
  });

  it('throws for unknown resource', () => {
    const guard = makeGuard({ models: {} });
    expect(() =>
      guard.canActivate(makeCtx({ method: 'GET', url: '/api/posts', params: { modelSlug: 'posts' } })),
    ).toThrow(RhinoException);
  });

  it('index: allows with viewAny permission', () => {
    const guard = makeGuard({ models: { posts: { model: 'post' } } });
    const ok = guard.canActivate(
      makeCtx({
        method: 'GET',
        url: '/api/1/posts',
        params: { modelSlug: 'posts' },
        user,
        organization: org,
      }),
    );
    expect(ok).toBe(true);
  });

  it('show: detects id param as show action', () => {
    const guard = makeGuard({ models: { posts: { model: 'post' } } });
    const ok = guard.canActivate(
      makeCtx({
        method: 'GET',
        url: '/api/1/posts/42',
        params: { modelSlug: 'posts', id: '42' },
        user,
        organization: org,
      }),
    );
    expect(ok).toBe(true);
  });

  it('denies when permission absent', () => {
    const guard = makeGuard({ models: { posts: { model: 'post' } } });
    const other = { id: 2, userRoles: [{ organizationId: 1, permissions: [] }] };
    expect(() =>
      guard.canActivate(
        makeCtx({
          method: 'DELETE',
          url: '/api/1/posts/42',
          params: { modelSlug: 'posts', id: '42' },
          user: other,
          organization: org,
        }),
      ),
    ).toThrow(RhinoException);
  });

  it('routes /trashed to viewTrashed action', () => {
    class P extends ResourcePolicy {
      viewTrashed() {
        return true;
      }
    }
    const guard = makeGuard({ models: { posts: { model: 'post', policy: P } } });
    const ok = guard.canActivate(
      makeCtx({
        method: 'GET',
        url: '/api/1/posts/trashed',
        params: { modelSlug: 'posts' },
        user,
        organization: org,
      }),
    );
    expect(ok).toBe(true);
  });

  it('routes /restore to restore action', () => {
    class P extends ResourcePolicy {
      restore() {
        return true;
      }
      view() {
        return false;
      }
    }
    const guard = makeGuard({ models: { posts: { model: 'post', policy: P } } });
    const ok = guard.canActivate(
      makeCtx({
        method: 'POST',
        url: '/api/1/posts/42/restore',
        params: { modelSlug: 'posts', id: '42' },
        user,
        organization: org,
      }),
    );
    expect(ok).toBe(true);
  });

  it('routes /force-delete to forceDelete action', () => {
    class P extends ResourcePolicy {
      forceDelete() {
        return true;
      }
    }
    const guard = makeGuard({ models: { posts: { model: 'post', policy: P } } });
    const ok = guard.canActivate(
      makeCtx({
        method: 'DELETE',
        url: '/api/1/posts/42/force-delete',
        params: { modelSlug: 'posts', id: '42' },
        user,
        organization: org,
      }),
    );
    expect(ok).toBe(true);
  });
});
