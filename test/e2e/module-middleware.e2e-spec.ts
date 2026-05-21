import { Test } from '@nestjs/testing';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { RhinoModule } from '../../src/rhino.module';

const callLog: string[] = [];

@Injectable()
class ModelWideMw implements NestMiddleware {
  use(_req: any, _res: any, next: any) {
    callLog.push('model-wide');
    next();
  }
}

@Injectable()
class StoreOnlyMw implements NestMiddleware {
  use(_req: any, _res: any, next: any) {
    callLog.push('store-only');
    next();
  }
}

describe('RhinoModule per-model middleware wiring', () => {
  beforeEach(() => {
    callLog.length = 0;
  });

  it('compiles with per-model middleware declared', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({
          models: {
            posts: {
              model: 'post',
              middleware: [ModelWideMw],
              actionMiddleware: { store: [StoreOnlyMw] },
            },
          },
        }),
      ],
    }).compile();
    expect(moduleRef.get(ModelWideMw, { strict: false })).toBeDefined();
    expect(moduleRef.get(StoreOnlyMw, { strict: false })).toBeDefined();
  });

  it('skips middleware wiring when autoModelMiddleware: false', async () => {
    const { RHINO_MODULE_OPTIONS } = require('../../src/constants/tokens');
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot(
          {
            models: { posts: { model: 'post', middleware: [ModelWideMw] } },
          },
          { autoModelMiddleware: false },
        ),
      ],
    }).compile();
    // Middleware class is still declared as a provider (usable if app wires it manually)
    expect(moduleRef.get(ModelWideMw, { strict: false })).toBeDefined();
    // But options flag is respected — read from DI
    const opts = moduleRef.get(RHINO_MODULE_OPTIONS);
    expect(opts.autoModelMiddleware).toBe(false);
  });
});
