import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ResponseInterceptor, paginated } from './response.interceptor';

function makeCtx(res: any) {
  return { switchToHttp: () => ({ getResponse: () => res }) } as any;
}

describe('ResponseInterceptor', () => {
  it('wraps paginated shape with data + headers', async () => {
    const headers: any = {};
    const res = { setHeader: (k: string, v: any) => (headers[k] = v) };
    const interceptor = new ResponseInterceptor();
    const body = paginated([{ id: 1 }], 10, 2, 5);
    const out = await firstValueFrom(
      interceptor.intercept(makeCtx(res), { handle: () => of(body) } as any),
    );
    expect(out).toEqual({ data: [{ id: 1 }] });
    expect(headers['X-Current-Page']).toBe(2);
    expect(headers['X-Last-Page']).toBe(2);
    expect(headers['X-Per-Page']).toBe(5);
    expect(headers['X-Total']).toBe(10);
  });

  it('pass-through for non-paginated responses', async () => {
    const res = { setHeader: jest.fn() };
    const interceptor = new ResponseInterceptor();
    const out = await firstValueFrom(
      interceptor.intercept(makeCtx(res), { handle: () => of({ id: 1 }) } as any),
    );
    expect(out).toEqual({ id: 1 });
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
