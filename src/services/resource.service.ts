import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { QueryBuilderService, ParsedQuery } from './query-builder.service';
import { ScopeService } from './scope.service';
import { resolveUserRoleSlug } from '../utils/permission-matcher';
import { RhinoException } from '../errors/rhino-exception';

export interface FindAllResult {
  items: any[];
  total?: number;
  page?: number;
  perPage?: number;
  lastPage?: number;
}

export interface ResourceContext {
  user?: any;
  organization?: any;
  orgIdentifierColumn?: string;
  includeTrashed?: boolean;
  onlyTrashed?: boolean;
}

@Injectable()
export class ResourceService {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly config: RhinoConfigService,
    protected readonly queryBuilder: QueryBuilderService,
    @Optional() protected readonly scopes?: ScopeService,
  ) {}

  protected applyScopes(
    where: Record<string, any>,
    modelSlug: string,
    ctx: ResourceContext,
  ): Record<string, any> {
    if (!this.scopes) return where;
    const reg = this.config.model(modelSlug);
    if (!reg) return where;
    return this.scopes.apply(where, reg, {
      user: ctx.user,
      organization: ctx.organization,
      userRole: resolveUserRoleSlug(ctx.user, ctx.organization?.id),
    });
  }

  protected delegate(modelSlug: string): any {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    return this.prisma.model(reg.model);
  }

  /**
   * Build the where fragment matching the `:id` URL segment. When the model's
   * resolved route key is `'id'` (the default) this is byte-identical to the
   * legacy behavior including `castId` numification. For a custom route key
   * the param is ALWAYS treated as a string — a digit-only hash like "48291"
   * must not be coerced to a number.
   */
  protected idWhere(
    modelSlug: string,
    id: string | number,
    hasUuid?: boolean,
  ): Record<string, any> {
    const key = this.config.routeKeyFor(modelSlug);
    if (key === 'id') return { id: this.castId(id, hasUuid) };
    return { [key]: String(id) };
  }

  /** Whether the model resolves its `:id` segment via a non-PK route key. */
  protected hasCustomRouteKey(modelSlug: string): boolean {
    return this.config.routeKeyFor(modelSlug) !== 'id';
  }

  /**
   * Resolve Prisma where filter for the current org context.
   *
   * - `belongsToOrganization` → direct `{ organizationId }` (unchanged).
   * - `owner` chain (indirect tenancy resolved at boot by
   *   `RhinoConfigService.orgPathFor`) → nested relation filter, e.g.
   *   comments → `{ task: { project: { organizationId } } }`.
   * - Neither (or unresolvable chain) → null (unscoped, legacy behavior).
   */
  protected orgFilter(modelSlug: string, org?: any): Record<string, any> | null {
    if (!org) return null;
    const reg = this.config.model(modelSlug);
    if (!reg) return null;
    if (reg.belongsToOrganization) return { organizationId: org.id };
    const path = this.config.orgPathFor(modelSlug);
    if (!path || path.length === 0) return null;
    let filter: Record<string, any> = { organizationId: org.id };
    for (let i = path.length - 1; i >= 0; i--) {
      filter = { [path[i]]: filter };
    }
    return filter;
  }

  /**
   * Compose an org-scope fragment into a where with AND semantics. Plain
   * `Object.assign` is kept for the common no-collision case (byte-identical
   * Prisma args to the legacy behavior); when the where already constrains one
   * of the org-scope keys (e.g. a client filter on the owning relation), the
   * two are AND-wrapped so BOTH always apply — the tenant filter can never be
   * overwritten, and it can never silently drop the caller's constraint.
   */
  protected withOrgScope(
    where: Record<string, any>,
    orgScope: Record<string, any> | null,
  ): Record<string, any> {
    if (!orgScope) return where;
    const collides = Object.keys(orgScope).some((k) =>
      Object.prototype.hasOwnProperty.call(where, k),
    );
    if (collides) return { AND: [where, orgScope] };
    return Object.assign(where, orgScope);
  }

  async findAll(modelSlug: string, rawQuery: Record<string, any>, ctx: ResourceContext = {}): Promise<FindAllResult> {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const parsed: ParsedQuery = this.queryBuilder.build(rawQuery, reg, { namedScopes: true });
    let where = this.withOrgScope(
      this.mergeWhere(parsed.where),
      this.orgFilter(modelSlug, ctx.organization),
    );
    where = this.applyScopes(where, modelSlug, ctx);

    // Apply the validated client-selectable named scope (index/trashed only).
    // ScopeService is @Optional() — fail CLOSED if it was never wired in.
    if (parsed.scopeName) {
      if (!this.scopes) {
        throw RhinoException.forbidden(`Scope '${parsed.scopeName}' is not allowed`);
      }
      where = this.scopes.applyNamed(parsed.scopeName, where, reg, {
        user: ctx.user,
        organization: ctx.organization,
        userRole: resolveUserRoleSlug(ctx.user, ctx.organization?.id),
      });
    }

    // soft delete visibility
    if (reg.softDeletes) {
      if (ctx.onlyTrashed) {
        where.deletedAt = { not: null };
      } else if (!ctx.includeTrashed) {
        where.deletedAt = null;
      }
    }

    const paginate = reg.paginationEnabled !== false;
    if (paginate) {
      const perPage = parsed.perPage ?? reg.perPage ?? 25;
      const page = parsed.page ?? 1;
      const skip = (page - 1) * perPage;
      const [items, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy: parsed.orderBy,
          include: parsed.include,
          select: parsed.select,
          skip,
          take: perPage,
        }),
        delegate.count({ where }),
      ]);
      return {
        items,
        total,
        page,
        perPage,
        lastPage: Math.max(1, Math.ceil(total / perPage)),
      };
    }
    const items = await delegate.findMany({
      where,
      orderBy: parsed.orderBy,
      include: parsed.include,
      select: parsed.select,
    });
    return { items };
  }

  /**
   * Evaluate collection-level computed attributes.
   *
   * The where filter handed to each callable has the organization scope, the
   * model's scopes, `?scope=`, `?filter[]=` and `?search=` already applied — so
   * the numbers describe exactly the set `findAll` would have returned. Sorting,
   * sparse fieldsets, includes and pagination are deliberately NOT applied.
   *
   * Each callable receives its own shallow copy of the where object so one
   * attribute's mutations can never leak into the next one's result.
   */
  async computeCollectionAttributes(
    modelSlug: string,
    rawQuery: Record<string, any>,
    names: string[],
    ctx: ResourceContext = {},
  ): Promise<Record<string, any>> {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const declared = reg.collectionComputedAttributes ?? {};

    const parsed: ParsedQuery = this.queryBuilder.build(rawQuery, reg, { namedScopes: true });
    let where = this.withOrgScope(
      this.mergeWhere(parsed.where),
      this.orgFilter(modelSlug, ctx.organization),
    );
    where = this.applyScopes(where, modelSlug, ctx);

    // Apply the validated client-selectable named scope, exactly as findAll does.
    // ScopeService is @Optional() — fail CLOSED if it was never wired in.
    if (parsed.scopeName) {
      if (!this.scopes) {
        throw RhinoException.forbidden(`Scope '${parsed.scopeName}' is not allowed`);
      }
      where = this.scopes.applyNamed(parsed.scopeName, where, reg, {
        user: ctx.user,
        organization: ctx.organization,
        userRole: resolveUserRoleSlug(ctx.user, ctx.organization?.id),
      });
    }

    if (reg.softDeletes && !ctx.includeTrashed) {
      where.deletedAt = null;
    }

    const out: Record<string, any> = {};
    for (const name of names) {
      const entry = declared[name];
      if (typeof entry !== 'function') {
        out[name] = entry;
        continue;
      }
      out[name] = await entry({
        where: { ...where },
        delegate,
        prisma: this.prisma.client,
        user: ctx.user,
        organization: ctx.organization,
        modelSlug,
      });
    }
    return out;
  }

  async findOne(modelSlug: string, id: string | number, rawQuery: Record<string, any>, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const parsed = this.queryBuilder.build(rawQuery, reg);
    let where: Record<string, any> = this.idWhere(modelSlug, id, reg.hasUuid);
    where = this.withOrgScope(where, this.orgFilter(modelSlug, ctx.organization));
    where = this.applyScopes(where, modelSlug, ctx);
    if (reg.softDeletes && !ctx.includeTrashed) where.deletedAt = null;
    return delegate.findFirst({ where, include: parsed.include, select: parsed.select });
  }

  async create(modelSlug: string, data: Record<string, any>, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const payload: Record<string, any> = { ...data };
    if (reg.belongsToOrganization && ctx.organization) {
      payload.organizationId = ctx.organization.id;
    }
    return delegate.create({ data: payload });
  }

  async update(modelSlug: string, id: string | number, data: Record<string, any>, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    let where: Record<string, any> = this.idWhere(modelSlug, id, reg.hasUuid);
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    where = this.withOrgScope(where, orgScope);

    // Reject attempts to change organizationId silently
    const payload = { ...data };
    delete payload.organizationId;
    delete payload.organization_id;

    // Prisma "update" doesn't allow extra where props; use updateMany + findFirst for org scope
    if (orgScope) {
      const res = await delegate.updateMany({ where, data: payload });
      if (res.count === 0) return null;
      return delegate.findFirst({ where });
    }
    // A custom route key is not guaranteed unique for Prisma's typed `update`
    // where — resolve the record first, then mutate by primary key. Mirrors
    // the org-scoped branch's not-found semantics (null when no match).
    if (this.hasCustomRouteKey(modelSlug)) {
      const existing = await delegate.findFirst({ where });
      if (!existing) return null;
      return delegate.update({ where: { id: existing.id }, data: payload });
    }
    return delegate.update({ where: { id: this.castId(id, reg.hasUuid) }, data: payload });
  }

  async delete(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    let where: Record<string, any> = this.idWhere(modelSlug, id, reg.hasUuid);
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    where = this.withOrgScope(where, orgScope);

    if (reg.softDeletes) {
      const res = await delegate.updateMany({ where, data: { deletedAt: new Date() } });
      return res.count > 0;
    }
    if (orgScope) {
      const res = await delegate.deleteMany({ where });
      return res.count > 0;
    }
    // Custom route key: not unique for Prisma's typed `delete` where — resolve
    // then delete by primary key, with org-branch not-found semantics (false).
    if (this.hasCustomRouteKey(modelSlug)) {
      const existing = await delegate.findFirst({ where });
      if (!existing) return false;
      await delegate.delete({ where: { id: existing.id } });
      return true;
    }
    await delegate.delete({ where: { id: this.castId(id, reg.hasUuid) } });
    return true;
  }

  async restore(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg?.softDeletes) throw new Error(`Model ${modelSlug} does not support soft deletes`);
    const delegate = this.delegate(modelSlug);
    let where: Record<string, any> = this.idWhere(modelSlug, id, reg.hasUuid);
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    where = this.withOrgScope(where, orgScope);
    const res = await delegate.updateMany({ where, data: { deletedAt: null } });
    return res.count > 0;
  }

  async forceDelete(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    let where: Record<string, any> = this.idWhere(modelSlug, id, reg.hasUuid);
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    where = this.withOrgScope(where, orgScope);
    if (orgScope) {
      const res = await delegate.deleteMany({ where });
      return res.count > 0;
    }
    // Custom route key: resolve then hard-delete by primary key (see delete()).
    if (this.hasCustomRouteKey(modelSlug)) {
      const existing = await delegate.findFirst({ where });
      if (!existing) return false;
      await delegate.delete({ where: { id: existing.id } });
      return true;
    }
    await delegate.delete({ where: { id: this.castId(id, reg.hasUuid) } });
    return true;
  }

  protected castId(id: string | number, hasUuid?: boolean): string | number {
    if (hasUuid) return String(id);
    if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
    return id;
  }

  protected mergeWhere(...parts: (Record<string, any> | null | undefined)[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const p of parts) {
      if (p) Object.assign(out, p);
    }
    return out;
  }
}
