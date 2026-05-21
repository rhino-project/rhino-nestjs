import { Test } from '@nestjs/testing';
import { RhinoModule } from './rhino.module';
import { RhinoConfigService } from './rhino.config';
import {
  RHINO_CONFIG,
  RHINO_MODULE_OPTIONS,
  RHINO_PRISMA_CLIENT,
} from './constants/tokens';
import { Injectable, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

describe('RhinoModule', () => {
  it('forRoot registers the config and services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({
          models: { posts: { model: 'post' } },
        }),
      ],
    }).compile();

    const config = moduleRef.get(RhinoConfigService);
    expect(config.hasModel('posts')).toBe(true);
    const raw = moduleRef.get(RHINO_CONFIG);
    expect(raw.nested.maxOperations).toBe(50);
  });

  it('registers CRUD/Auth/Invitation/Nested controllers by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RhinoModule.forRoot({ models: { posts: { model: 'post' } } })],
    }).compile();
    // If controllers were registered, NestJS will have instantiated them during compile()
    // and they'll appear in the DI graph.
    const {
      GlobalController,
    } = require('./controllers/global.controller');
    const ctrl = moduleRef.get(GlobalController);
    expect(ctrl).toBeDefined();
  });

  it('registerControllers:false skips controller registration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot(
          { models: { posts: { model: 'post' } } },
          { registerControllers: false },
        ),
      ],
    }).compile();
    const { GlobalController } = require('./controllers/global.controller');
    expect(() => moduleRef.get(GlobalController)).toThrow();
  });

  it('injects the prismaClient from forRoot config', async () => {
    const fakePrisma = { $connect: jest.fn(), $disconnect: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({
          prismaClient: fakePrisma as any,
          models: { posts: { model: 'post' } },
        }),
      ],
    }).compile();
    const { PrismaService } = require('./prisma/prisma.service');
    const svc = moduleRef.get(PrismaService);
    expect(svc.client).toBe(fakePrisma);
  });

  it('forRootAsync resolves prismaClient and config via useFactory', async () => {
    const fakePrisma = { $connect: jest.fn(), $disconnect: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRootAsync({
          useFactory: async () => ({
            prismaClient: fakePrisma as any,
            models: { posts: { model: 'post' } },
          }),
        }),
      ],
    }).compile();
    const { PrismaService } = require('./prisma/prisma.service');
    const svc = moduleRef.get(PrismaService);
    expect(svc.client).toBe(fakePrisma);
  });

  it('no-static-state: two instances do not cross-pollute', async () => {
    const p1 = { $connect: jest.fn(), $disconnect: jest.fn(), tag: 'one' };
    const p2 = { $connect: jest.fn(), $disconnect: jest.fn(), tag: 'two' };
    const [m1, m2] = await Promise.all([
      Test.createTestingModule({
        imports: [RhinoModule.forRoot({ prismaClient: p1 as any, models: {} })],
      }).compile(),
      Test.createTestingModule({
        imports: [RhinoModule.forRoot({ prismaClient: p2 as any, models: {} })],
      }).compile(),
    ]);
    const { PrismaService } = require('./prisma/prisma.service');
    expect((m1.get(PrismaService).client as any).tag).toBe('one');
    expect((m2.get(PrismaService).client as any).tag).toBe('two');
  });

  // ---------------------------------------------------------------------
  // BP-010: injection tokens are exported so consumer providers can use them
  // ---------------------------------------------------------------------
  describe('BP-010: RHINO_PRISMA_CLIENT / RHINO_CONFIG / RHINO_MODULE_OPTIONS tokens', () => {
    it('RHINO_PRISMA_CLIENT is resolvable from a downstream module', async () => {
      const fakePrisma = { $connect: jest.fn(), $disconnect: jest.fn(), tag: 'from-token' };

      @Injectable()
      class ConsumerService {
        constructor(
          // Using inject array would be cleaner but this shape is more typical
        ) {}
        static ref: any;
      }

      @Module({
        providers: [
          {
            provide: 'CAPTURE_CLIENT',
            useFactory: (prisma: any) => {
              ConsumerService.ref = prisma;
              return prisma;
            },
            inject: [RHINO_PRISMA_CLIENT],
          },
        ],
      })
      class ConsumerModule {}

      await Test.createTestingModule({
        imports: [
          RhinoModule.forRoot({
            prismaClient: fakePrisma as any,
            models: {},
          }),
          ConsumerModule,
        ],
      }).compile();

      expect(ConsumerService.ref).toBe(fakePrisma);
    });

    it('RHINO_CONFIG token gives consumer the normalized config', async () => {
      let captured: any;

      @Module({
        providers: [
          {
            provide: 'CAPTURE_CFG',
            useFactory: (cfg: any) => {
              captured = cfg;
              return cfg;
            },
            inject: [RHINO_CONFIG],
          },
        ],
      })
      class ConsumerModule {}

      await Test.createTestingModule({
        imports: [
          RhinoModule.forRoot({ models: { posts: { model: 'post' } } }),
          ConsumerModule,
        ],
      }).compile();

      expect(captured).toBeDefined();
      expect(captured.models.posts.model).toBe('post');
      expect(captured.nested.maxOperations).toBe(50); // normalized default present
    });

    it('RHINO_MODULE_OPTIONS exposes user-supplied options', async () => {
      let captured: any;

      @Module({
        providers: [
          {
            provide: 'CAPTURE_OPTS',
            useFactory: (opts: any) => {
              captured = opts;
              return opts;
            },
            inject: [RHINO_MODULE_OPTIONS],
          },
        ],
      })
      class ConsumerModule {}

      await Test.createTestingModule({
        imports: [
          RhinoModule.forRoot(
            { models: {} },
            { registerControllers: false, autoModelMiddleware: false },
          ),
          ConsumerModule,
        ],
      }).compile();

      expect(captured).toEqual({
        registerControllers: false,
        autoModelMiddleware: false,
      });
    });

    it('all three tokens resolve without throwing when fetched directly from the module ref', async () => {
      const fakePrisma = { $connect: jest.fn(), $disconnect: jest.fn() };
      const moduleRef = await Test.createTestingModule({
        imports: [
          RhinoModule.forRoot({
            prismaClient: fakePrisma as any,
            models: {},
          }),
        ],
      }).compile();

      expect(() => moduleRef.get(RHINO_PRISMA_CLIENT)).not.toThrow();
      expect(() => moduleRef.get(RHINO_CONFIG)).not.toThrow();
      expect(() => moduleRef.get(RHINO_MODULE_OPTIONS)).not.toThrow();
      expect(moduleRef.get(RHINO_PRISMA_CLIENT)).toBe(fakePrisma);
    });
  });

  it('forRootAsync resolves the config through a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRootAsync({
          useFactory: async () => ({
            models: { comments: { model: 'comment' } },
          }),
        }),
      ],
    }).compile();

    const config = moduleRef.get(RhinoConfigService);
    expect(config.hasModel('comments')).toBe(true);
  });
});
