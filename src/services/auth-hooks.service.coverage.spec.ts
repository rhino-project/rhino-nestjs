import { AuthHooksService } from './auth-hooks.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import type { AuthLifecycleHooks } from '../interfaces/rhino-config.interface';

// Coverage for the hooks resolver's DI / fallback / failure paths. No production
// code changes.
describe('AuthHooksService.resolve — coverage', () => {
  const cfg = (hooks: any) =>
    new RhinoConfigService(normalizeConfig({ models: {}, routeGroups: { driver: { models: '*', hooks } } }));

  class DriverHooks implements AuthLifecycleHooks {
    async afterLogin(): Promise<void> {}
  }

  it('resolves the hooks instance from ModuleRef when available', () => {
    const instance = new DriverHooks();
    const moduleRef = { get: jest.fn().mockReturnValue(instance) };
    const svc = new AuthHooksService(cfg(DriverHooks), moduleRef as any);
    const resolved = svc.resolve('driver');
    expect(moduleRef.get).toHaveBeenCalledWith(DriverHooks, { strict: false });
    expect(resolved).toBe(instance);
  });

  it('falls back to direct construction when ModuleRef.get throws', () => {
    const moduleRef = {
      get: jest.fn(() => {
        throw new Error('not registered');
      }),
    };
    const svc = new AuthHooksService(cfg(DriverHooks), moduleRef as any);
    expect(svc.resolve('driver')).toBeInstanceOf(DriverHooks);
  });

  it('directly constructs the hooks class when no ModuleRef is wired', () => {
    const svc = new AuthHooksService(cfg(DriverHooks));
    expect(svc.resolve('driver')).toBeInstanceOf(DriverHooks);
  });

  it('returns null when the hooks class cannot be constructed', () => {
    class BrokenHooks implements AuthLifecycleHooks {
      constructor() {
        throw new Error('missing dependency');
      }
      async afterLogin(): Promise<void> {}
    }
    const svc = new AuthHooksService(cfg(BrokenHooks));
    expect(svc.resolve('driver')).toBeNull();
  });

  it('returns null for a group with no hooks configured', () => {
    const svc = new AuthHooksService(cfg(undefined));
    expect(svc.resolve('driver')).toBeNull();
  });
});
