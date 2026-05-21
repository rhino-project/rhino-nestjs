import { of, firstValueFrom } from 'rxjs';
import { HiddenColumnsInterceptor } from './hidden-columns.interceptor';
import { SerializerService } from '../services/serializer.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { ResourcePolicy } from '../policies/resource-policy';
import { paginated } from './response.interceptor';

function makeCtx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

function makeInterceptor(models: any) {
  const config = new RhinoConfigService(normalizeConfig({ models }));
  const serializer = new SerializerService();
  return new HiddenColumnsInterceptor(config, serializer);
}

class NarrowPolicy extends ResourcePolicy {
  permittedAttributesForShow() {
    return ['name'];
  }
}

describe('HiddenColumnsInterceptor', () => {
  it('returns body unchanged when modelSlug is missing from the request', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: {} };
    const body = { id: 1, secret: 'x' };
    const out = await firstValueFrom(
      ic.intercept(makeCtx(req), { handle: () => of(body) } as any),
    );
    expect(out).toBe(body); // pass-through
  });

  it('returns body unchanged when modelSlug is not registered', async () => {
    const ic = makeInterceptor({});
    const req = { params: { modelSlug: 'unknown' } };
    const body = { id: 1, secret: 'x' };
    const out = await firstValueFrom(
      ic.intercept(makeCtx(req), { handle: () => of(body) } as any),
    );
    expect(out).toBe(body);
  });

  it('serializes a single record through the policy whitelist', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: { modelSlug: 'posts' }, user: {} };
    const out: any = await firstValueFrom(
      ic.intercept(makeCtx(req), {
        handle: () => of({ id: 1, name: 'A', secret: 'x', password: 'y' }),
      } as any),
    );
    // NarrowPolicy keeps only `name` + id is always preserved
    expect(out).toEqual({ id: 1, name: 'A' });
  });

  it('preserves paginated envelope shape and serializes inner items', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: { modelSlug: 'posts' } };
    const envelope = paginated(
      [
        { id: 1, name: 'A', secret: 'x' },
        { id: 2, name: 'B', secret: 'y' },
      ],
      2, 1, 25,
    );
    const out: any = await firstValueFrom(
      ic.intercept(makeCtx(req), { handle: () => of(envelope) } as any),
    );
    expect(out.__rhinoPaginated).toBe(true);
    expect(out.items).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(out.total).toBe(2);
    expect(out.perPage).toBe(25);
  });

  it('serializes a { data: [...] } envelope', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: { modelSlug: 'posts' } };
    const body = { data: [{ id: 1, name: 'A', secret: 'x' }] };
    const out: any = await firstValueFrom(
      ic.intercept(makeCtx(req), { handle: () => of(body) } as any),
    );
    expect(out.data).toEqual([{ id: 1, name: 'A' }]);
  });

  it('serializes a bare array response', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: { modelSlug: 'posts' } };
    const out: any = await firstValueFrom(
      ic.intercept(makeCtx(req), {
        handle: () => of([{ id: 1, name: 'A', secret: 'x' }]),
      } as any),
    );
    expect(out).toEqual([{ id: 1, name: 'A' }]);
  });

  it('returns null/undefined bodies unchanged', async () => {
    const ic = makeInterceptor({ posts: { model: 'post', policy: NarrowPolicy } });
    const req = { params: { modelSlug: 'posts' } };
    const out = await firstValueFrom(
      ic.intercept(makeCtx(req), { handle: () => of(null) } as any),
    );
    expect(out).toBeNull();
  });
});
