import { Inject, Injectable, Optional } from '@nestjs/common';
import { z, ZodSchema, ZodObject, ZodTypeAny } from 'zod';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { resolveUserRoleSlug } from '../utils/permission-matcher';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { findOrganizationFkChain, FkChainStep } from '../utils/fk-chain-walker';

export interface ValidationResult<T = Record<string, any>> {
  valid: boolean;
  data?: T;
  errors?: Record<string, string[]>;
  forbiddenFields?: string[];
}

export interface ValidationContext {
  user?: any;
  organization?: any;
  action: 'store' | 'update';
}

/**
 * Validates request data against a registered model's Zod schema.
 *
 * Responsibilities mirror Laravel's HasValidation trait:
 *   - Pick schema based on action (store/update), with role-keyed overrides
 *   - Intersect fields with policy's `permittedAttributesFor{Create,Update}`
 *   - Reject forbidden fields (HTTP 403 semantics; returned in errors)
 *   - Strip the `organizationId` field from user-supplied input when in tenant context
 */
export interface FkConstraint {
  field: string;
  model: string;
}

@Injectable()
export class ValidationService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: RhinoConfigService,
  ) {}

  /**
   * Verify that every foreign-key in `data` references a record that lives
   * inside the current organization (directly or through an FK chain). This
   * implements Laravel's `scopeExistsRulesToOrganization` semantics for Prisma.
   *
   * Constraints are declared per model via:
   *   ModelRegistration.fkConstraints?: Array<{ field: 'postId', model: 'post' }>
   */
  async verifyTenantFks(
    data: Record<string, any>,
    reg: ModelRegistration,
    organization?: any,
  ): Promise<{ valid: boolean; errors?: Record<string, string[]> }> {
    if (!organization || !this.prisma || !this.config) return { valid: true };
    const constraints: FkConstraint[] = (reg as any).fkConstraints ?? [];
    if (constraints.length === 0) return { valid: true };
    const errors: Record<string, string[]> = {};
    for (const c of constraints) {
      const value = data[c.field];
      if (value == null) continue;
      const ok = await this.isFkInOrg(c.model, value, organization);
      if (!ok) {
        errors[c.field] = [`referenced record not found in this organization`];
      }
    }
    return Object.keys(errors).length === 0
      ? { valid: true }
      : { valid: false, errors };
  }

  private async isFkInOrg(model: string, id: any, organization: any): Promise<boolean> {
    const delegate = this.prisma!.model(model);
    // Fast path: model itself has organizationId
    const record = await delegate.findFirst({
      where: { id, organizationId: organization.id },
    }).catch(() => null);
    if (record) return true;

    // Otherwise walk FK chain based on registered models
    const chain = findOrganizationFkChain(model, {
      getRelations: (m) => {
        const reg = this.config!.models();
        for (const r of Object.values(reg)) {
          if (r.model === m && (r as any).fkConstraints) {
            return ((r as any).fkConstraints as FkConstraint[]).map((c) => ({
              localColumn: c.field,
              foreignModel: c.model,
              foreignColumn: 'id',
            }));
          }
        }
        return [];
      },
      hasOrganizationId: (m) => {
        for (const r of Object.values(this.config!.models())) {
          if (r.model === m && r.belongsToOrganization) return true;
        }
        return false;
      },
    });
    if (!chain) return false;
    return this.walkFkChainForRecord(model, id, chain, organization);
  }

  private async walkFkChainForRecord(
    startModel: string,
    id: any,
    chain: FkChainStep[],
    organization: any,
  ): Promise<boolean> {
    let currentModel = startModel;
    let currentId = id;
    for (const step of chain) {
      const delegate = this.prisma!.model(currentModel);
      const record = await delegate.findUnique({ where: { id: currentId } }).catch(() => null);
      if (!record) return false;
      currentId = record[step.localColumn];
      currentModel = step.foreignModel;
      if (step.leadsToOrg) {
        const parent = await this.prisma!.model(currentModel).findFirst({
          where: { id: currentId, organizationId: organization.id },
        }).catch(() => null);
        return Boolean(parent);
      }
    }
    return false;
  }

  validateForAction<T = Record<string, any>>(
    data: Record<string, any>,
    reg: ModelRegistration,
    ctx: ValidationContext,
  ): ValidationResult<T> {
    const input = { ...data };

    // Strip framework-managed fields when inside a tenant context.
    if (ctx.organization) {
      delete input.organizationId;
      delete input.organization_id;
    }

    // Resolve permitted fields from the policy.
    const permittedFields = this.resolvePermittedFields(reg, ctx);
    const allowAllFields = permittedFields.length === 1 && permittedFields[0] === '*';

    // Reject forbidden fields explicitly.
    if (!allowAllFields) {
      const forbidden = Object.keys(input).filter((k) => !permittedFields.includes(k));
      if (forbidden.length > 0) {
        return {
          valid: false,
          forbiddenFields: forbidden,
          errors: { _forbidden: forbidden },
        };
      }
    }

    // Pick the right schema (store vs update, role-keyed vs direct).
    let schema = this.pickSchema(reg, ctx);
    if (!schema) {
      // No schema → pass-through. Still removes forbidden fields above.
      return { valid: true, data: input as T };
    }

    // If the schema is an object-shape and permittedFields restricts a subset,
    // narrow down using pick() so unknown fields aren't required.
    if (!allowAllFields && schema instanceof ZodObject) {
      const pickShape = Object.fromEntries(permittedFields.map((f) => [f, true]));
      try {
        schema = schema.pick(pickShape as any);
      } catch {
        // ignore — keep full schema
      }
    }

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { valid: false, errors: this.formatErrors(parsed.error) };
    }
    return { valid: true, data: parsed.data as T };
  }

  private pickSchema(reg: ModelRegistration, ctx: ValidationContext): ZodSchema | undefined {
    const key = ctx.action;
    const actionSchema = key === 'store' ? reg.validationStore : reg.validationUpdate;
    if (actionSchema) {
      if ((actionSchema as any)._def && typeof (actionSchema as any).safeParse === 'function') {
        return actionSchema as ZodSchema;
      }
      // role-keyed
      const roleKeyed = actionSchema as Record<string, ZodSchema>;
      const role = resolveUserRoleSlug(ctx.user, ctx.organization?.id);
      if (role && roleKeyed[role]) return roleKeyed[role];
      if (roleKeyed['*']) return roleKeyed['*'];
    }
    return reg.validation;
  }

  private resolvePermittedFields(reg: ModelRegistration, ctx: ValidationContext): string[] {
    if (!reg.policy) return ['*'];
    const policy = new reg.policy();
    // BP-007 completion: pass organization so policy.hasRole(user, role, org)
    // can resolve the active role (same reasoning as SerializerService —
    // this path was missed in the original BP-007 fix).
    if (ctx.action === 'store') {
      return policy.permittedAttributesForCreate(ctx.user, ctx.organization) ?? ['*'];
    }
    return policy.permittedAttributesForUpdate(ctx.user, ctx.organization) ?? ['*'];
  }

  private formatErrors(err: z.ZodError): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      if (!out[path]) out[path] = [];
      out[path].push(issue.message);
    }
    return out;
  }
}
