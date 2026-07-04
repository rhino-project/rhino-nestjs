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

  /** Resolve Prisma where filter for the current org context. */
  protected orgFilter(modelSlug: string, org?: any): Record<string, any> | null {
    if (!org) return null;
    const reg = this.config.model(modelSlug);
    if (!reg?.belongsToOrganization) return null;
    return { organizationId: org.id };
  }

  async findAll(modelSlug: string, rawQuery: Record<string, any>, ctx: ResourceContext = {}): Promise<FindAllResult> {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const parsed: ParsedQuery = this.queryBuilder.build(rawQuery, reg, { namedScopes: true });
    let where = this.mergeWhere(parsed.where, this.orgFilter(modelSlug, ctx.organization));
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

  async findOne(modelSlug: string, id: string | number, rawQuery: Record<string, any>, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const parsed = this.queryBuilder.build(rawQuery, reg);
    let where: Record<string, any> = { id: this.castId(id, reg.hasUuid) };
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    if (orgScope) Object.assign(where, orgScope);
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
    const where: Record<string, any> = { id: this.castId(id, reg.hasUuid) };
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    if (orgScope) Object.assign(where, orgScope);

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
    return delegate.update({ where: { id: this.castId(id, reg.hasUuid) }, data: payload });
  }

  async delete(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const where: Record<string, any> = { id: this.castId(id, reg.hasUuid) };
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    if (orgScope) Object.assign(where, orgScope);

    if (reg.softDeletes) {
      const res = await delegate.updateMany({ where, data: { deletedAt: new Date() } });
      return res.count > 0;
    }
    if (orgScope) {
      const res = await delegate.deleteMany({ where });
      return res.count > 0;
    }
    await delegate.delete({ where: { id: this.castId(id, reg.hasUuid) } });
    return true;
  }

  async restore(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg?.softDeletes) throw new Error(`Model ${modelSlug} does not support soft deletes`);
    const delegate = this.delegate(modelSlug);
    const where: Record<string, any> = { id: this.castId(id, reg.hasUuid) };
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    if (orgScope) Object.assign(where, orgScope);
    const res = await delegate.updateMany({ where, data: { deletedAt: null } });
    return res.count > 0;
  }

  async forceDelete(modelSlug: string, id: string | number, ctx: ResourceContext = {}) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw new Error(`Unknown model: ${modelSlug}`);
    const delegate = this.delegate(modelSlug);
    const where: Record<string, any> = { id: this.castId(id, reg.hasUuid) };
    const orgScope = this.orgFilter(modelSlug, ctx.organization);
    if (orgScope) Object.assign(where, orgScope);
    if (orgScope) {
      const res = await delegate.deleteMany({ where });
      return res.count > 0;
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
