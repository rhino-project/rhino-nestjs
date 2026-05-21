import { Injectable } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

export interface ScopeContext {
  user?: any;
  organization?: any;
  userRole?: string | null;
}

export interface RhinoScope {
  apply(where: Record<string, any>, context: ScopeContext): Record<string, any>;
}

/**
 * Applies all registered scopes for a model in order.
 * Scopes are classes implementing `RhinoScope`.
 */
@Injectable()
export class ScopeService {
  apply(where: Record<string, any>, reg: ModelRegistration, ctx: ScopeContext): Record<string, any> {
    const scopes = reg.scopes ?? [];
    let merged = { ...where };
    for (const ScopeClass of scopes) {
      const scope = new (ScopeClass as any)();
      if (typeof scope.apply === 'function') {
        merged = scope.apply(merged, ctx) ?? merged;
      }
    }
    return merged;
  }
}
