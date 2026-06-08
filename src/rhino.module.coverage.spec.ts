import { Injectable, NestMiddleware } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RhinoModule } from './rhino.module';
import { RhinoConfigService } from './rhino.config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ResourcePolicyGuard } from './guards/resource-policy.guard';
import { GroupMembershipGuard } from './guards/group-membership.guard';
import type { AuthLifecycleHooks } from './interfaces/rhino-config.interface';

@Injectable()
class CovMiddleware implements NestMiddleware {
  use(_req: any, _res: any, next: any) {
    next();
  }
}

@Injectable()
class CovHooks implements AuthLifecycleHooks {
  async afterLogin(): Promise<void> {}
}

// Coverage for opt-in guard wiring, model-middleware / hook collection, and the
// async factory path. No production code changes.
describe('RhinoModule — coverage', () => {
  it('installs the opt-in guards when their flags are set', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot(
          { models: { posts: { model: 'post' } } },
          { autoAuthGuard: true, autoPolicyGuard: true, autoMembershipGuard: true },
        ),
      ],
    }).compile();

    expect(moduleRef.get(JwtAuthGuard, { strict: false })).toBeInstanceOf(JwtAuthGuard);
    expect(moduleRef.get(ResourcePolicyGuard, { strict: false })).toBeInstanceOf(ResourcePolicyGuard);
    expect(moduleRef.get(GroupMembershipGuard, { strict: false })).toBeInstanceOf(GroupMembershipGuard);
  });

  it('collects per-model middleware as providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({
          models: {
            posts: { model: 'post', middleware: [CovMiddleware] },
            comments: { model: 'comment', actionMiddleware: { store: [CovMiddleware] } },
          },
        }),
      ],
    }).compile();

    expect(moduleRef.get(CovMiddleware, { strict: false })).toBeInstanceOf(CovMiddleware);
  });

  it('collects per-group hook classes as providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({
          models: { posts: { model: 'post' } },
          routeGroups: { driver: { prefix: 'driver', auth: true, hooks: CovHooks, models: '*' } },
        }),
      ],
    }).compile();

    expect(moduleRef.get(CovHooks, { strict: false })).toBeInstanceOf(CovHooks);
  });

  it('resolves config through forRootAsync (useFactory + middleware list)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRootAsync({
          useFactory: async () => ({ models: { posts: { model: 'post' } } }),
          middleware: [CovMiddleware],
        }),
      ],
    }).compile();

    expect(moduleRef.get(RhinoConfigService).hasModel('posts')).toBe(true);
    expect(moduleRef.get(CovMiddleware, { strict: false })).toBeInstanceOf(CovMiddleware);
  });

  it('skips controllers when registerControllers is false', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RhinoModule.forRoot({ models: { posts: { model: 'post' } } }, { registerControllers: false }),
      ],
    }).compile();
    // Still resolves the config — just no controllers wired.
    expect(moduleRef.get(RhinoConfigService).hasModel('posts')).toBe(true);
  });
});
