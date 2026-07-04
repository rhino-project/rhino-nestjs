import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { QueryBuilderService } from './query-builder.service';
import { ScopeService } from './scope.service';
import { ResourceService, ResourceContext } from './resource.service';
import { resolveUserRoleSlug } from '../utils/permission-matcher';
import { RhinoException } from '../errors/rhino-exception';

export interface ScopedWhereOptions {
  /** A whitelisted key of `reg.namedScopes` to AND into the scoped where. */
  namedScope?: string;
}

/**
 * Tenant-safe query composer for custom controllers/services that go beyond
 * CRUD (dashboards, aggregations, jobs). This is the NestJS equivalent of the
 * Laravel `Rhino::query` helper.
 *
 * It exposes the SAME scoping `ResourceService` applies to CRUD
 * (`orgFilter` + global `scopes` + optional whitelisted named scope) as a
 * public API, and adds a **fail-closed** guarantee: a model that
 * `belongsToOrganization` MUST be queried with an organization context, or the
 * resolver throws (`403 TENANT_CONTEXT_REQUIRED`) instead of silently returning
 * an unscoped, cross-tenant query.
 *
 * Prefer the convenience delegate helpers (`count`/`aggregate`/`groupBy`/
 * `findMany`) — they inject the scoped where so a caller cannot forget it.
 */
@Injectable()
export class ResourceScopeService extends ResourceService {
  constructor(
    prisma: PrismaService,
    config: RhinoConfigService,
    queryBuilder: QueryBuilderService,
    @Optional() scopes?: ScopeService,
  ) {
    super(prisma, config, queryBuilder, scopes);
  }

  /**
   * Resolve the tenant-safe Prisma `where` for a model in the given context.
   *
   * Composes: `orgFilter` (org isolation) + global `scopes` (user-aware) +
   * an optional whitelisted named scope. **Fails closed** when the model
   * `belongsToOrganization` but no organization is present in `ctx`.
   */
  scopedWhere(
    modelSlug: string,
    ctx: ResourceContext = {},
    opts: ScopedWhereOptions = {},
  ): Record<string, any> {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);

    // Fail CLOSED: a tenant-scoped model queried with no org context must NOT
    // silently degrade to an unscoped (cross-tenant) query. Contrast findAll,
    // whose orgFilter simply returns null.
    if (reg.belongsToOrganization && !ctx.organization) {
      throw RhinoException.tenantContextRequired(
        `Rhino resource scope for '${modelSlug}' requires an organization context`,
      );
    }

    let where: Record<string, any> = this.orgFilter(modelSlug, ctx.organization) ?? {};
    where = this.applyScopes(where, modelSlug, ctx);

    // AND a client/caller-selected named scope fragment. `applyNamed` fails
    // closed (403) for unknown / non-whitelisted / prototype keys, and AND-wraps
    // so the named scope can never drop the org filter or the global scopes.
    if (opts.namedScope) {
      if (!this.scopes) {
        throw RhinoException.forbidden(`Scope '${opts.namedScope}' is not allowed`);
      }
      where = this.scopes.applyNamed(opts.namedScope, where, reg, {
        user: ctx.user,
        organization: ctx.organization,
        userRole: resolveUserRoleSlug(ctx.user, ctx.organization?.id),
      });
    }

    return where;
  }

  /**
   * Merge the caller-provided `where` under the scoped where so BOTH always
   * apply — the scoped constraints can never be overwritten or dropped.
   */
  private compose(
    modelSlug: string,
    ctx: ResourceContext,
    opts: ScopedWhereOptions,
    extraWhere?: Record<string, any>,
  ): Record<string, any> {
    const scoped = this.scopedWhere(modelSlug, ctx, opts);
    if (!extraWhere || Object.keys(extraWhere).length === 0) return scoped;
    return { AND: [scoped, extraWhere] };
  }

  /** Expose the Prisma delegate for advanced use. Prefer the scoped helpers. */
  delegate(modelSlug: string): any {
    return super.delegate(modelSlug);
  }

  /** `count` with the scoped where AND-ed with any caller-provided where. */
  count(
    modelSlug: string,
    ctx: ResourceContext = {},
    extraWhere?: Record<string, any>,
    opts: ScopedWhereOptions = {},
  ): Promise<number> {
    const where = this.compose(modelSlug, ctx, opts, extraWhere);
    return this.delegate(modelSlug).count({ where });
  }

  /** `findMany` with the scoped where AND-ed into `args.where`. */
  findMany(
    modelSlug: string,
    ctx: ResourceContext = {},
    args: Record<string, any> = {},
    opts: ScopedWhereOptions = {},
  ): Promise<any[]> {
    const where = this.compose(modelSlug, ctx, opts, args.where);
    return this.delegate(modelSlug).findMany({ ...args, where });
  }

  /** `aggregate` with the scoped where AND-ed into `args.where`. */
  aggregate(
    modelSlug: string,
    ctx: ResourceContext = {},
    args: Record<string, any> = {},
    opts: ScopedWhereOptions = {},
  ): Promise<any> {
    const where = this.compose(modelSlug, ctx, opts, args.where);
    return this.delegate(modelSlug).aggregate({ ...args, where });
  }

  /** `groupBy` with the scoped where AND-ed into `args.where`. */
  groupBy(
    modelSlug: string,
    ctx: ResourceContext = {},
    args: Record<string, any> = {},
    opts: ScopedWhereOptions = {},
  ): Promise<any> {
    const where = this.compose(modelSlug, ctx, opts, args.where);
    return this.delegate(modelSlug).groupBy({ ...args, where });
  }
}
