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
   * Enforce include-level authorization: every `?include=relation` must be
   * a resource the user can `viewAny`. This mirrors Laravel's Gate::authorize
   * check run inside GlobalController when resolving includes.
   */
  private assertIncludesAuthorized(rawInclude: any, req: any) {
    if (!rawInclude) return;
    const paths = String(rawInclude).split(',').map((s) => s.trim()).filter(Boolean);
    const slugs = new Set<string>();
    for (const p of paths) slugs.add(p.split('.')[0]);
    for (const slug of slugs) {
      const reg = this.config.model(slug);
      if (!reg) continue;
      const PolicyClass = reg.policy ?? ResourcePolicy;
      const policy = new PolicyClass();
      policy.resourceSlug = slug;
      if (!policy.viewAny(req.user, req.organization)) {
        throw RhinoException.includeNotAuthorized(slug);
      }
    }
  }

  @Get(':modelSlug/trashed')
  async trashed(
    @Param('modelSlug') modelSlug: string,
    @Query() query: any,
    @Req() req: ReqWithCtx,
  ) {
    const reg = this.assertActionAllowed(modelSlug, 'trashed');
    if (!reg.softDeletes) throw RhinoException.actionDisabled('trashed');
    const result = await this.resources.findAll(modelSlug, query, {
      user: req.user,
      organization: req.organization,
      onlyTrashed: true,
    });
    const items = this.serializer.serializeMany(result.items, reg, { user: req.user, organization: req.organization });
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
    this.assertIncludesAuthorized(query?.include, req);
    const result = await this.resources.findAll(modelSlug, query, {
      user: req.user,
      organization: req.organization,
    });
    const items = this.serializer.serializeMany(result.items, reg, { user: req.user, organization: req.organization });
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
    this.assertIncludesAuthorized(query?.include, req);
    const record = await this.resources.findOne(modelSlug, id, query, {
      user: req.user,
      organization: req.organization,
    });
    if (!record) throw RhinoException.notFound();
    return this.serializer.serializeOne(record, reg, { user: req.user, organization: req.organization });
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
      await this.audit.log({
        auditableType: reg.model,
        auditableId: id,
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
