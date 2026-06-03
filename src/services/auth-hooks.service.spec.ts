import { AuthHooksService } from './auth-hooks.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { RhinoAuthRejected } from '../errors/rhino-exception';
import type {
  AuthLifecycleHooks,
  RhinoConfig,
} from '../interfaces/rhino-config.interface';

function hooksSvc(cfg: Partial<RhinoConfig>) {
  const config = new RhinoConfigService(
    normalizeConfig({ models: {}, ...cfg } as RhinoConfig),
  );
  return new AuthHooksService(config);
}

describe('AuthHooksService', () => {
  it('resolve returns null for a group with no hooks', () => {
    const svc = hooksSvc({ routeGroups: { driver: { models: '*' } } });
    expect(svc.resolve('driver')).toBeNull();
  });

  it('resolve returns null for an unknown / null group', () => {
    const svc = hooksSvc({});
    expect(svc.resolve(null)).toBeNull();
    expect(svc.resolve('nope')).toBeNull();
  });

  it('run is a no-op when no hooks are configured', async () => {
    const svc = hooksSvc({ routeGroups: { driver: { models: '*' } } });
    await expect(
      svc.run('afterLogin', 'driver', { user: { id: 1 } }),
    ).resolves.toBeUndefined();
  });

  it('resolves & runs a plain-object hooks implementation', async () => {
    const calls: string[] = [];
    const obj: AuthLifecycleHooks = {
      afterLogin: () => {
        calls.push('login');
      },
    };
    const svc = hooksSvc({ routeGroups: { driver: { models: '*', hooks: obj } } });
    await svc.run('afterLogin', 'driver', { user: { id: 1 }, routeGroup: 'driver' });
    expect(calls).toEqual(['login']);
  });

  it('resolves & runs a class hooks implementation (direct construction)', async () => {
    const seen: any[] = [];
    class DriverHooks implements AuthLifecycleHooks {
      async afterRegister(ctx: any) {
        seen.push(ctx);
      }
    }
    const svc = hooksSvc({ routeGroups: { driver: { models: '*', hooks: DriverHooks } } });
    await svc.run('afterRegister', 'driver', { user: { id: 7 }, routeGroup: 'driver' });
    expect(seen).toHaveLength(1);
    expect(seen[0].user.id).toBe(7);
  });

  it('an absent method on a present hooks object is a no-op', async () => {
    const obj: AuthLifecycleHooks = { afterLogin: () => undefined };
    const svc = hooksSvc({ routeGroups: { driver: { models: '*', hooks: obj } } });
    await expect(
      svc.run('afterLogout', 'driver', { user: { id: 1 } }),
    ).resolves.toBeUndefined();
  });

  it('propagates a rejection thrown by a hook', async () => {
    const obj: AuthLifecycleHooks = {
      afterLogin: () => {
        throw new RhinoAuthRejected('nope', 401);
      },
    };
    const svc = hooksSvc({ routeGroups: { driver: { models: '*', hooks: obj } } });
    await expect(svc.run('afterLogin', 'driver', { user: { id: 1 } })).rejects.toThrow(
      RhinoAuthRejected,
    );
  });

  it('each event fires with the supplied context', async () => {
    const events: Record<string, any> = {};
    const obj: AuthLifecycleHooks = {
      afterLogin: (c) => void (events.afterLogin = c),
      afterLogout: (c) => void (events.afterLogout = c),
      afterRegister: (c) => void (events.afterRegister = c),
      afterPasswordRecover: (c) => void (events.afterPasswordRecover = c),
      afterPasswordReset: (c) => void (events.afterPasswordReset = c),
    };
    const svc = hooksSvc({ routeGroups: { g: { models: '*', hooks: obj } } });
    const ctx = { user: { id: 1 }, routeGroup: 'g', organization: { id: 2 }, token: 't' };
    for (const ev of [
      'afterLogin',
      'afterLogout',
      'afterRegister',
      'afterPasswordRecover',
      'afterPasswordReset',
    ] as const) {
      await svc.run(ev, 'g', ctx);
      expect(events[ev]).toMatchObject({ routeGroup: 'g', user: { id: 1 } });
    }
  });
});
