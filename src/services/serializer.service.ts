import { Injectable } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

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
    const { user, organization } = this.normalizeCtx(ctx);
    let result = { ...record };

    if (reg.computedAttributes) {
      Object.assign(result, reg.computedAttributes(record, user));
    }

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
        const keep = new Set([...permitted, 'id']);
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

  private normalizeCtx(ctx: SerializeContext | any): SerializeContext {
    // New call shape: { user, organization }
    if (ctx && typeof ctx === 'object' && ('user' in ctx || 'organization' in ctx)) {
      return { user: (ctx as SerializeContext).user, organization: (ctx as SerializeContext).organization };
    }
    // Legacy call shape: a bare user (or null/undefined)
    return { user: ctx, organization: undefined };
  }
}
