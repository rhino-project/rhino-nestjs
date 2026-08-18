import { Injectable, Optional } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { RhinoConfigService } from '../rhino.config';

export const BASE_HIDDEN_COLUMNS = [
  'password',
  'rememberToken',
  'remember_token',
  'hasTemporaryPassword',
  'has_temporary_password',
  'updatedAt',
  'updated_at',
  'createdAt',
  'created_at',
  'deletedAt',
  'deleted_at',
  'emailVerifiedAt',
  'email_verified_at',
];

/**
 * Context object for serialization. `organization` is required for role-based
 * policy attribute filtering — without it, `hasRole(user, role, org)` in
 * consumer policies can never resolve the active role and every request
 * would collapse to the "no role" fallback (BP-007).
 *
 * Legacy signature: `serializeOne(record, reg, user)` is still accepted for
 * backwards compatibility. New callers should pass the object form.
 */
export interface SerializeContext {
  user?: any;
  organization?: any;
  /**
   * OPT-IN record-level computed attributes selected by the client via
   * `?computed_attributes=`. Only these names are evaluated; anything else
   * declared in `recordComputedAttributes` stays untouched.
   */
  computedAttributes?: string[];
}

/**
 * Serializes a record according to the Laravel `asRhinoJson` contract:
 *
 * 1. Merge computed attributes
 * 2. Remove base-hidden columns
 * 3. Remove model-level `additionalHiddenColumns`
 * 4. Apply policy blacklist (`hiddenAttributesForShow`)
 * 5. Apply policy whitelist (`permittedAttributesForShow`) — `id` always kept
 */
@Injectable()
export class SerializerService {
  /**
   * Config is optional for backwards compatibility (`new SerializerService()`
   * in older tests/consumers) — without it, only the per-model `routeKey`
   * participates in whitelist retention (the global default falls back to 'id').
   */
  constructor(@Optional() private readonly config?: RhinoConfigService) {}

  /** Resolved route key: per-model, then global config default, then 'id'. */
  private routeKeyOf(reg: ModelRegistration): string {
    return reg.routeKey ?? this.config?.globalRouteKey() ?? 'id';
  }

  /**
   * @param record  The raw record to serialize (from Prisma).
   * @param reg     The model registration driving policy + computed attrs.
   * @param ctx     Either a `SerializeContext` object (preferred) or a
   *                legacy `user` value (backwards-compat shim — org will
   *                be undefined and role-keyed policies will collapse).
   */
  serializeOne(
    record: Record<string, any> | null | undefined,
    reg: ModelRegistration,
    ctx?: SerializeContext | any,
  ): Record<string, any> | null {
    if (!record) return record as any;
    const { user, organization, computedAttributes } = this.normalizeCtx(ctx);
    let result = { ...record };

    if (reg.computedAttributes) {
      Object.assign(result, reg.computedAttributes(record, user));
    }

    // Merge the OPT-IN record-level computed attributes the client selected.
    // Nothing is evaluated unless it was asked for by name. Merged BEFORE
    // policy filtering, so the blacklist/whitelist below still govern them.
    Object.assign(result, this.resolveRecordComputed(record, reg, computedAttributes, user));

    for (const col of BASE_HIDDEN_COLUMNS) {
      delete (result as any)[col];
    }

    if (reg.additionalHiddenColumns?.length) {
      for (const col of reg.additionalHiddenColumns) delete (result as any)[col];
    }

    if (reg.policy) {
      const policy = new reg.policy();
      // BP-007: pass organization as the second argument so policy methods
      // that call `this.hasRole(user, 'admin', org)` can resolve the active
      // role. Base ResourcePolicy signatures accept an optional org.
      const hidden = policy.hiddenAttributesForShow(user, organization) ?? [];
      for (const col of hidden) delete (result as any)[col];

      const permitted = policy.permittedAttributesForShow(user, organization) ?? ['*'];
      if (!(permitted.length === 1 && permitted[0] === '*')) {
        // Always keep `id` AND the resolved route-key column — a whitelist
        // must never strip the value clients need to address the record.
        const keep = new Set([...permitted, 'id', this.routeKeyOf(reg)]);
        result = Object.fromEntries(
          Object.entries(result).filter(([k]) => keep.has(k)),
        ) as any;
      }
    }

    return result;
  }

  serializeMany(
    records: any[],
    reg: ModelRegistration,
    ctx?: SerializeContext | any,
  ): any[] {
    return records.map((r) => this.serializeOne(r, reg, ctx));
  }

  /**
   * Evaluate the selected opt-in record-level computed attributes.
   *
   * Names that are not declared are silently skipped — the controller has
   * already rejected unknown/forbidden names with a 403, and a direct
   * serializer caller must not be able to force an arbitrary call.
   */
  private resolveRecordComputed(
    record: Record<string, any>,
    reg: ModelRegistration,
    names: string[] | undefined,
    user: any,
  ): Record<string, any> {
    if (!names || names.length === 0) return {};
    const declared = reg.recordComputedAttributes;
    if (!declared) return {};

    const out: Record<string, any> = {};
    for (const name of names) {
      if (typeof name !== 'string') continue;
      if (!Object.prototype.hasOwnProperty.call(declared, name)) continue;
      const entry = declared[name];
      out[name] = typeof entry === 'function' ? entry(record, user) : entry;
    }
    return out;
  }

  private normalizeCtx(ctx: SerializeContext | any): SerializeContext {
    // New call shape: { user, organization, computedAttributes }
    if (
      ctx &&
      typeof ctx === 'object' &&
      ('user' in ctx || 'organization' in ctx || 'computedAttributes' in ctx)
    ) {
      return {
        user: (ctx as SerializeContext).user,
        organization: (ctx as SerializeContext).organization,
        computedAttributes: (ctx as SerializeContext).computedAttributes,
      };
    }
    // Legacy call shape: a bare user (or null/undefined)
    return { user: ctx, organization: undefined };
  }
}
