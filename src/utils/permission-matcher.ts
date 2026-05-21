/**
 * Coerce a raw permissions value into a string array.
 *
 * BP-008 — databases without a native array type (SQLite, older MySQL) must
 * store permissions as JSON strings or comma-separated lists. Laravel's
 * Eloquent `$casts = ['permissions' => 'array']` decodes JSON on read;
 * Prisma has no equivalent. This helper accepts all common shapes so the
 * matcher works without a consumer-side hydration hack.
 *
 * Accepted inputs (in order of preference):
 *   - string[]              → returned as-is
 *   - JSON array string     → parsed
 *   - comma-separated string → split & trimmed
 *   - null / undefined / other → []
 */
export function coercePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through to comma split */
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Match a `{slug}.{action}` permission against a set of granted permissions.
 *
 * Supports wildcards identically to the Laravel version:
 *   - `*`              → grants everything
 *   - `{slug}.*`       → grants all actions on a specific slug
 *   - `{slug}.{act}`   → exact match
 *
 * The `granted` argument accepts anything `coercePermissions` accepts: a
 * real array, a JSON-string array, or a comma-separated string.
 */
export function matchesPermission(
  permission: string,
  granted: string[] | string | null | undefined,
): boolean {
  const list = coercePermissions(granted);
  if (list.length === 0) return false;
  const slug = permission.split('.')[0] ?? '';
  const slugWildcard = `${slug}.*`;
  for (const p of list) {
    if (p === permission || p === '*' || p === slugWildcard) return true;
  }
  return false;
}

/**
 * Resolve the role slug for a user in a specific organization.
 * Expects a user object shaped like the Laravel user with userRoles relation.
 */
export function resolveUserRoleSlug(user: any, organizationId: number | string | null | undefined): string | null {
  if (!user || organizationId == null) return null;
  const userRoles = user.userRoles ?? user.user_roles ?? [];
  for (const ur of userRoles) {
    const orgId = ur.organizationId ?? ur.organization_id;
    if (orgId === organizationId) {
      return ur.role?.slug ?? ur.roleSlug ?? ur.role_slug ?? null;
    }
  }
  return null;
}

/**
 * Resolve permissions granted to a user in an organization context.
 * Tenant context → aggregates permissions from all user_roles entries
 *                  matching the organization.
 * No org context → returns the user's top-level permissions array.
 */
export function resolveUserPermissions(user: any, organizationId?: number | string | null): string[] {
  if (!user) return [];
  if (organizationId != null) {
    const userRoles = user.userRoles ?? user.user_roles ?? [];
    const all: string[] = [];
    for (const ur of userRoles) {
      const orgId = ur.organizationId ?? ur.organization_id;
      if (orgId === organizationId) {
        // BP-008: coerce into an array first — value may arrive as a raw
        // JSON string from SQLite/MySQL or similar DBs without native arrays.
        for (const p of coercePermissions(ur.permissions)) all.push(p);
      }
    }
    return all;
  }
  return coercePermissions(user.permissions);
}

/**
 * Top-level permission check mirroring the Laravel `hasPermission` method.
 */
export function userHasPermission(
  user: any,
  permission: string,
  organization?: { id: number | string } | null,
): boolean {
  if (!user) return false;
  const orgId = organization ? organization.id : null;
  const permissions = resolveUserPermissions(user, orgId);
  return matchesPermission(permission, permissions);
}
