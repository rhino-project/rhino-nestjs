import { userHasPermission, resolveUserRoleSlug } from '../utils/permission-matcher';

/**
 * Base authorization policy. Subclass and override per-resource.
 * Matches Laravel's `Rhino\Policies\ResourcePolicy` semantics 1:1.
 */
export class ResourcePolicy {
  /**
   * Resource slug used in the `{slug}.{action}` permission lookup.
   * If not set, the guard will inject it from the model registry at runtime.
   */
  resourceSlug?: string;

  // ---------------- CRUD ----------------
  viewAny(user: any, organization?: any): boolean {
    return this.checkPermission(user, 'index', organization);
  }
  view(user: any, _model: any, organization?: any): boolean {
    return this.checkPermission(user, 'show', organization);
  }
  create(user: any, organization?: any): boolean {
    return this.checkPermission(user, 'store', organization);
  }
  update(user: any, _model: any, organization?: any): boolean {
    return this.checkPermission(user, 'update', organization);
  }
  delete(user: any, _model: any, organization?: any): boolean {
    return this.checkPermission(user, 'destroy', organization);
  }

  // ---------------- Soft delete ----------------
  viewTrashed(user: any, organization?: any): boolean {
    return this.checkPermission(user, 'trashed', organization);
  }
  restore(user: any, _model: any, organization?: any): boolean {
    return this.checkPermission(user, 'restore', organization);
  }
  forceDelete(user: any, _model: any, organization?: any): boolean {
    return this.checkPermission(user, 'forceDelete', organization);
  }

  // ---------------- Attribute permissions ----------------
  // `org` is optional so subclasses can use `this.hasRole(user, '...', org)`.
  // The built-in SerializerService / ValidationService call these without org —
  // leave org `undefined` in that path and rely on role detection from the user
  // itself (Laravel parity).
  permittedAttributesForShow(_user: any, _org?: any): string[] {
    return ['*'];
  }
  hiddenAttributesForShow(_user: any, _org?: any): string[] {
    return [];
  }
  permittedAttributesForCreate(_user: any, _org?: any): string[] {
    return ['*'];
  }
  permittedAttributesForUpdate(_user: any, _org?: any): string[] {
    return ['*'];
  }

  // ---------------- Helpers ----------------
  protected checkPermission(user: any, action: string, organization?: any): boolean {
    if (!user) return false;
    const slug = this.resourceSlug;
    if (!slug) return false;
    return userHasPermission(user, `${slug}.${action}`, organization ?? null);
  }

  protected hasRole(user: any, role: string, organization?: any): boolean {
    if (!user) return false;
    const orgId = organization?.id;
    if (orgId == null) return false;
    return resolveUserRoleSlug(user, orgId) === role;
  }
}
