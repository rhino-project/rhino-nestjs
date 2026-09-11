import { Injectable } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { RhinoException } from '../errors/rhino-exception';

export interface ScopeContext {
  user?: any;
  organization?: any;
  userRole?: string | null;
  /**
   * Arguments the client sent for a named scope, bound by name to the
   * parameters the scope class declares in `static params`. Empty for a scope
   * that declares none.
   */
  args?: Record<string, any>;
}

export interface RhinoScope {
  apply(where: Record<string, any>, context: ScopeContext): Record<string, any>;
}

/**
 * A client-selectable named scope (`?scope=<key>`). Unlike a global
 * `RhinoScope` (which receives and returns the whole `where`), a named scope
 * returns ONLY a Prisma where-fragment given the current context; Rhino ANDs
 * that fragment into the existing query. This makes it impossible for a scope
 * to drop the org / filter / search / soft-delete constraints.
 */
export interface RhinoNamedScope {
  /**
   * Return a Prisma where-fragment; Rhino ANDs it with the existing where.
   * Client-supplied arguments arrive as `context.args`, keyed by the parameter
   * names the class declares:
   *
   *   class WindowScope implements RhinoNamedScope {
   *     static params = ['from', 'to'];
   *     static optionalParams = ['to'];
   *     apply(ctx: ScopeContext) {
   *       return { createdAt: { gte: ctx.args!.from, lte: ctx.args!.to } };
   *     }
   *   }
   */
  apply(context: ScopeContext): Record<string, any>;
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

  /**
   * Resolve and apply a single client-requested named scope, AND-ing its
   * fragment into `where`. Fails CLOSED with a 403 `RhinoException` when the
   * name is not an own key of `reg.namedScopes`, resolves to a non-class value
   * (e.g. a prototype key like `constructor`), or the class lacks an `apply`.
   */
  applyNamed(
    name: string,
    where: Record<string, any>,
    reg: ModelRegistration,
    ctx: ScopeContext,
  ): Record<string, any> {
    const ScopeClass =
      reg.namedScopes && Object.prototype.hasOwnProperty.call(reg.namedScopes, name)
        ? reg.namedScopes[name]
        : undefined;
    if (typeof ScopeClass !== 'function') {
      throw RhinoException.forbidden(`Scope '${name}' is not allowed`);
    }
    const scope = new (ScopeClass as any)();
    if (typeof scope.apply !== 'function') {
      throw RhinoException.forbidden(`Scope '${name}' is not allowed`);
    }
    const fragment = scope.apply(ctx);
    return fragment ? { AND: [where, fragment] } : where;
  }
}
