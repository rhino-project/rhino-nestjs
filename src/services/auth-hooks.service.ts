import { Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RhinoConfigService } from '../rhino.config';
import type {
  AuthHookContext,
  AuthLifecycleHooks,
} from '../interfaces/rhino-config.interface';

export type AuthHookEvent =
  | 'afterLogin'
  | 'afterLogout'
  | 'afterRegister'
  | 'afterPasswordRecover'
  | 'afterPasswordReset';

/**
 * Resolves a group's optional lifecycle-hooks class/object and runs a single
 * event (design §7). A hook may reject by throwing — the caller (auth
 * controller) decides whether to revoke a token. When a group has no `hooks`
 * config, every event is a silent no-op.
 *
 * `ModuleRef` is optional so the service works in lightweight unit tests that
 * construct it without a Nest container; in that case a `Type` hooks value is
 * instantiated directly via `new`.
 */
@Injectable()
export class AuthHooksService {
  constructor(
    private readonly config: RhinoConfigService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /** Resolve the hooks instance for a group, or `null` when none is configured. */
  resolve(routeGroup: string | null | undefined): AuthLifecycleHooks | null {
    const hooks = this.config.routeGroupHooks(routeGroup);
    if (!hooks) return null;
    // Plain object implementing the contract.
    if (typeof hooks !== 'function') return hooks as AuthLifecycleHooks;
    // A class/Type: prefer the DI container, fall back to direct construction.
    const Cls = hooks as new (...args: any[]) => AuthLifecycleHooks;
    if (this.moduleRef) {
      try {
        const instance = this.moduleRef.get(Cls, { strict: false });
        if (instance) return instance;
      } catch {
        /* not registered as a provider — construct directly below */
      }
    }
    try {
      return new Cls();
    } catch {
      return null;
    }
  }

  /**
   * Run a single lifecycle event for the resolved group. Returns silently when
   * the group has no hooks or the specific method is absent. A rejection
   * propagates to the caller verbatim.
   */
  async run(
    event: AuthHookEvent,
    routeGroup: string | null | undefined,
    ctx: AuthHookContext,
  ): Promise<void> {
    const instance = this.resolve(routeGroup);
    if (!instance) return;
    const fn = instance[event];
    if (typeof fn !== 'function') return;
    await fn.call(instance, ctx);
  }
}
