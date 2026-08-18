import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { RhinoConfigService } from '../rhino.config';
import { ResourceService } from '../services/resource.service';
import { SerializerService } from '../services/serializer.service';
import { ValidationService } from '../services/validation.service';
import { AuditService } from '../services/audit.service';
import { ResponseInterceptor, paginated } from '../interceptors/response.interceptor';
import { ResourcePolicy } from '../policies/resource-policy';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoRequest } from '../interfaces/rhino-request.interface';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

type ReqWithCtx = RhinoRequest;

/**
 * The automatic CRUD controller. Registered with the dynamic route prefix
 * by the route-registration helper (see services/route-registration.service.ts).
 *
 * All HTTP endpoints for any registered model flow through this controller
 * via the `:modelSlug` parameter — matching Laravel's `GlobalController`.
 */
@Controller()
@UseInterceptors(ResponseInterceptor)
export class GlobalController {
  constructor(
    private readonly config: RhinoConfigService,
    private readonly resources: ResourceService,
    private readonly serializer: SerializerService,
    private readonly validator: ValidationService,
    private readonly audit: AuditService,
  ) {}

  private assertActionAllowed(modelSlug: string, action: string) {
    const reg = this.config.model(modelSlug);
    if (!reg) throw RhinoException.unknownResource(modelSlug);
    if (reg.exceptActions?.includes(action)) {
      throw RhinoException.actionDisabled(action);
    }
    return reg;
  }

  /**
   * Enforce include-level authorization: every `?include=relation` must resolve
   * to a REGISTERED resource the user can `viewAny`. This mirrors Laravel/Rails,
   * which authorize an include against the RELATED MODEL (not the relation name).
   *
   * An include that does not resolve to a registered resource is HARD-DENIED —
   * the lib never silently exposes a relation it cannot authorize (e.g. a
   * `belongsTo(User)` named `assignee` when `users` isn't registered).
   */
  private assertIncludesAuthorized(rawInclude: any, req: any, parentSlug?: string) {
    if (!rawInclude) return;
    const paths = String(rawInclude).split(',').map((s) => s.trim()).filter(Boolean);
    const parentReg = parentSlug ? this.config.model(parentSlug) : undefined;

    const seen = new Set<string>();
    for (const p of paths) {
      const relation = p.split('.')[0];
      if (seen.has(relation)) continue;
      seen.add(relation);

      const targetSlug = this.resolveIncludeTargetSlug(relation, parentReg);
      if (!targetSlug) {
        throw RhinoException.includeNotAuthorized(relation);
      }

      const reg = this.config.model(targetSlug)!;
      const PolicyClass = reg.policy ?? ResourcePolicy;
      const policy = new PolicyClass();
      policy.resourceSlug = targetSlug;
      if (!policy.viewAny(req.user, req.organization)) {
        throw RhinoException.includeNotAuthorized(relation);
      }
    }
  }

  /**
   * Resolve an include relation name to the slug of a REGISTERED model, matching
   * the Laravel/Rails behavior of gating on the related model:
   *   1. the include name is itself a registered slug, or
   *   2. a belongsTo relation whose FK is declared in the parent's fkConstraints
   *      ({ field, model }) — relation `assignee` maps to FK `assigneeId` /
   *      `assignee_id` → fk.model → the slug registered for that model.
   * Returns null when the relation does not resolve to a registered resource.
   */
  private resolveIncludeTargetSlug(relation: string, parentReg?: ModelRegistration): string | null {
    if (this.config.model(relation)) return relation;

    const fk = (parentReg?.fkConstraints ?? []).find(
      (c) => c.field === `${relation}Id` || c.field === `${relation}_id` || c.field === relation,
    );
    if (fk) {
      const slug = this.slugForModelName(fk.model);
      if (slug) return slug;
    }
    return null;
  }

  /** Reverse lookup: the registered slug whose model name (or slug) matches. */
  private slugForModelName(modelName: string): string | null {
    const target = String(modelName).toLowerCase();
    for (const [slug, reg] of Object.entries(this.config.models())) {
      if (slug.toLowerCase() === target || String(reg.model).toLowerCase() === target) {
        return slug;
      }
    }
    return null;
  }

  /**
   * GET /api/{resource}/computed?attributes=a,b
   *
   * Collection-level computed attributes: each declared callable is evaluated
   * ONCE over the whole (scoped + filtered) collection instead of once per row,
   * which is what makes aggregates such as `activeUsersCount` cheap.
   *
   * Omitting `?attributes=` returns every declared attribute the policy allows.
   */
  /**
   * Split a comma-separated attribute list, dropping blanks and duplicates.
   * A non-string param (e.g. `?attributes[]=x`) is rejected outright.
   */
  private parseAttributeList(raw: any): string[] {
    if (typeof raw !== 'string') {
      throw RhinoException.forbidden('Computed attributes are not allowed');
    }
    return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  }

  /**
   * Whether the policy lets this user see a computed attribute.
   *
   * Computed attributes go through the SAME gate as columns:
   * `hiddenAttributesForShow()` blacklists, and `permittedAttributesForShow()`
   * whitelists unless it returns the `['*']` default.
   */
  private computedAttributeAllowed(name: string, reg: ModelRegistration, req: any): boolean {
    if (!reg.policy) return true;
    const policy = new reg.policy();
    const hidden = policy.hiddenAttributesForShow(req.user, req.organization) ?? [];
    if (hidden.includes(name)) return false;
    const permitted = policy.permittedAttributesForShow(req.user, req.organization) ?? ['*'];
    if (permitted.length === 1 && permitted[0] === '*') return true;
    return permitted.includes(name);
  }

  /**
   * Parse and authorize `?attributes=a,b` for the /computed endpoint.
   *
   * An undeclared name and a policy-denied name produce the SAME 403, so the
   * endpoint never reveals which attributes a model declares. Omitting the
   * param selects every declared attribute the policy allows.
   */
  private resolveRequestedCollectionAttributes(
    raw: any,
    declared: Record<string, any>,
    reg: ModelRegistration,
    req: any,
  ): string[] {
    if (raw == null || raw === '') {
      return Object.keys(declared).filter((name) => this.computedAttributeAllowed(name, reg, req));
    }

    const names = this.parseAttributeList(raw);
    for (const name of names) {
      const isDeclared = Object.prototype.hasOwnProperty.call(declared, name);
      if (!isDeclared || !this.computedAttributeAllowed(name, reg, req)) {
        throw RhinoException.forbidden(`Computed attribute '${name}' is not allowed`);
      }
    }
    return names;
  }

  /**
   * Parse and authorize `?computed_attributes=a,b` for index/show/trashed —
   * the OPT-IN record-level computed attributes. Absent or empty means "none",
   * which is byte-for-byte the pre-feature behavior.
   */
  private resolveRequestedComputedAttributes(
    query: any,
    reg: ModelRegistration,
    req: any,
  ): string[] {
    const raw = query?.computed_attributes ?? query?.computedAttributes;
    if (raw == null || raw === '') return [];

    const names = this.parseAttributeList(raw);
    if (names.length === 0) return [];

    const declared = reg.recordComputedAttributes ?? {};
    for (const name of names) {
      const isDeclared = Object.prototype.hasOwnProperty.call(declared, name);
      if (!isDeclared || !this.computedAttributeAllowed(name, reg, req)) {
        throw RhinoException.forbidden(`Computed attribute '${name}' is not allowed`);
      }
    }
    return names;
  }

  @Get(':modelSlug/computed')
  async computed(
    @Param('modelSlug') modelSlug: string,
    @Query() query: any,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'computed');

    const declared = reg.collectionComputedAttributes;
    // A model that declares nothing keeps the pre-feature behavior: the path
    // is simply not a resource of this API.
    if (!declared || Object.keys(declared).length === 0) {
      throw RhinoException.notFound();
    }

    const names = this.resolveRequestedCollectionAttributes(query?.attributes, declared, reg, req);

    const data = await this.resources.computeCollectionAttributes(modelSlug, query, names, {
      user: req.user,
      organization: req.organization,
    });

    return { data };
  }

  @Get(':modelSlug/trashed')
  async trashed(
    @Param('modelSlug') modelSlug: string,
    @Query() query: any,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'trashed');
    if (!reg.softDeletes) throw RhinoException.actionDisabled('trashed');
    const computedAttributes = this.resolveRequestedComputedAttributes(query, reg, req);
    const result = await this.resources.findAll(modelSlug, query, {
      user: req.user,
      organization: req.organization,
      onlyTrashed: true,
    });
    const items = this.serializer.serializeMany(result.items, reg, {
      user: req.user,
      organization: req.organization,
      computedAttributes,
    });
    if (result.total != null) {
      return paginated(items, result.total, result.page!, result.perPage!);
    }
    return { data: items };
  }

  @Get(':modelSlug')
  async index(
    @Param('modelSlug') modelSlug: string,
    @Query() query: any,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'index');
    this.assertIncludesAuthorized(query?.include, req, modelSlug);
    const computedAttributes = this.resolveRequestedComputedAttributes(query, reg, req);
    const result = await this.resources.findAll(modelSlug, query, {
      user: req.user,
      organization: req.organization,
    });
    const items = this.serializer.serializeMany(result.items, reg, {
      user: req.user,
      organization: req.organization,
      computedAttributes,
    });
    if (result.total != null) {
      return paginated(items, result.total, result.page!, result.perPage!);
    }
    return { data: items };
  }

  @Get(':modelSlug/:id')
  async show(
    @Param('modelSlug') modelSlug: string,
    @Param('id') id: string,
    @Query() query: any,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'show');
    this.assertIncludesAuthorized(query?.include, req, modelSlug);
    const computedAttributes = this.resolveRequestedComputedAttributes(query, reg, req);
    const record = await this.resources.findOne(modelSlug, id, query, {
      user: req.user,
      organization: req.organization,
    });
    if (!record) throw RhinoException.notFound();
    return this.serializer.serializeOne(record, reg, {
      user: req.user,
      organization: req.organization,
      computedAttributes,
    });
  }

  @Post(':modelSlug')
  async store(
    @Param('modelSlug') modelSlug: string,
    @Body() body: Record<string, any>,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'store');
    const validation = this.validator.validateForAction(body, reg, {
      action: 'store',
      user: req.user,
      organization: req.organization,
    });
    if (!validation.valid) {
      if (validation.forbiddenFields) {
        throw RhinoException.forbiddenFields(validation.forbiddenFields);
      }
      throw RhinoException.validationFailed(validation.errors ?? {});
    }
    const fkCheck = await this.validator.verifyTenantFks(validation.data!, reg, req.organization);
    if (!fkCheck.valid) {
      throw RhinoException.crossTenant(fkCheck.errors ?? {});
    }
    const record = await this.resources.create(modelSlug, validation.data!, {
      user: req.user,
      organization: req.organization,
    });
    if (reg.hasAuditTrail) {
      await this.audit.log({
        auditableType: reg.model,
        auditableId: (record as any).id,
        action: 'created',
        newValues: record,
        ctx: { user: req.user, organization: req.organization },
        excludeFields: reg.auditExclude,
      });
    }
    return this.serializer.serializeOne(record, reg, { user: req.user, organization: req.organization });
  }

  @Put(':modelSlug/:id')
  async update(
    @Param('modelSlug') modelSlug: string,
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'update');
    const existing = await this.resources.findOne(modelSlug, id, {}, {
      user: req.user,
      organization: req.organization,
    });
    if (!existing) throw RhinoException.notFound();

    const validation = this.validator.validateForAction(body, reg, {
      action: 'update',
      user: req.user,
      organization: req.organization,
    });
    if (!validation.valid) {
      if (validation.forbiddenFields) {
        throw RhinoException.forbiddenFields(validation.forbiddenFields);
      }
      throw RhinoException.validationFailed(validation.errors ?? {});
    }
    const fkCheck = await this.validator.verifyTenantFks(validation.data!, reg, req.organization);
    if (!fkCheck.valid) {
      throw RhinoException.crossTenant(fkCheck.errors ?? {});
    }
    const record = await this.resources.update(modelSlug, id, validation.data!, {
      user: req.user,
      organization: req.organization,
    });
    if (!record) throw RhinoException.notFound();

    if (reg.hasAuditTrail) {
      const diff = this.audit.diff(existing, record, reg);
      if (diff) {
        await this.audit.log({
          auditableType: reg.model,
          auditableId: (record as any).id,
          action: 'updated',
          oldValues: diff.old,
          newValues: diff.new,
          ctx: { user: req.user, organization: req.organization },
          excludeFields: reg.auditExclude,
        });
      }
    }
    return this.serializer.serializeOne(record, reg, { user: req.user, organization: req.organization });
  }

  @Delete(':modelSlug/:id')
  @HttpCode(204)
  async destroy(
    @Param('modelSlug') modelSlug: string,
    @Param('id') id: string,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'destroy');
    const existing = await this.resources.findOne(modelSlug, id, {}, {
      user: req.user,
      organization: req.organization,
    });
    if (!existing) throw RhinoException.notFound();
    const ok = await this.resources.delete(modelSlug, id, {
      user: req.user,
      organization: req.organization,
    });
    if (!ok) throw RhinoException.notFound();
    if (reg.hasAuditTrail) {
      await this.audit.log({
        auditableType: reg.model,
        auditableId: (existing as any).id,
        action: 'deleted',
        oldValues: existing,
        ctx: { user: req.user, organization: req.organization },
        excludeFields: reg.auditExclude,
      });
    }
    return;
  }

  @Post(':modelSlug/:id/restore')
  async restore(
    @Param('modelSlug') modelSlug: string,
    @Param('id') id: string,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'restore');
    if (!reg.softDeletes) throw RhinoException.actionDisabled('restore');
    const ok = await this.resources.restore(modelSlug, id, {
      user: req.user,
      organization: req.organization,
    });
    if (!ok) throw RhinoException.notFound();
    if (reg.hasAuditTrail) {
      // Log the record's REAL primary key, not the raw route param — with a
      // custom routeKey the two diverge (and this also fixes the pre-existing
      // inconsistency with show/update/destroy, which log the record id).
      const restored = await this.resources.findOne(modelSlug, id, {}, {
        user: req.user,
        organization: req.organization,
      });
      await this.audit.log({
        auditableType: reg.model,
        auditableId: (restored as any)?.id ?? id,
        action: 'restored',
        ctx: { user: req.user, organization: req.organization },
      });
    }
    return { restored: true };
  }

  @Delete(':modelSlug/:id/force-delete')
  @HttpCode(204)
  async forceDelete(
    @Param('modelSlug') modelSlug: string,
    @Param('id') id: string,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'forceDelete');
    if (!reg.softDeletes) throw RhinoException.actionDisabled('forceDelete');
    const existing = await this.resources.findOne(modelSlug, id, {}, {
      user: req.user,
      organization: req.organization,
      includeTrashed: true,
    });
    if (!existing) throw RhinoException.notFound();
    const ok = await this.resources.forceDelete(modelSlug, id, {
      user: req.user,
      organization: req.organization,
    });
    if (!ok) throw RhinoException.notFound();
    if (reg.hasAuditTrail) {
      await this.audit.log({
        auditableType: reg.model,
        auditableId: (existing as any).id,
        action: 'forceDeleted',
        oldValues: existing,
        ctx: { user: req.user, organization: req.organization },
        excludeFields: reg.auditExclude,
      });
    }
    return;
  }
}
