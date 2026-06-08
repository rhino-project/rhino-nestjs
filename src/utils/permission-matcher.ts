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

// ──────────────────────────────────────────────────────────────────────────
// Layered permissions (PERMISSIONS_DESIGN.md)
//
//   effective = (role ∪ granted) − denied        (deny always wins)
//
//   - role    → org_role_permissions[(org, role)].permissions  (shared role layer)
//   - granted → user_roles.granted_permissions                 (per-user additive)
//   - denied  → user_roles.denied_permissions                  (per-user subtractive)
//   - legacy  → user_roles.permissions                         (back-compat allow)
//
// The matcher reads these from the in-memory user object. `grantedPermissions`
// / `deniedPermissions` are scalar columns on user_roles (loaded automatically).
// The role layer is read from the row's `role.orgRolePermissions` (Prisma deep
// include), filtered to the row's own organization — or from a pre-resolved
// `rolePermissions` list if a service attached one.
// ──────────────────────────────────────────────────────────────────────────

function readOrgId(ur: any): number | string | null | undefined {
  return ur?.organizationId ?? ur?.organization_id;
}

/** The shared role-layer permissions for a single user_role row. */
export function rowRolePermissions(ur: any): string[] {
  if (!ur) return [];
  // Pre-resolved by a service (e.g. raw-SQL consumers).
  const direct = ur.rolePermissions ?? ur.role_permissions;
  if (direct != null) return coercePermissions(direct);

  // From the role's org_role_permissions, scoped to this row's organization.
  const orgId = readOrgId(ur);
  const layers =
    ur.role?.orgRolePermissions ??
    ur.role?.org_role_permissions ??
    ur.orgRolePermissions ??
    ur.org_role_permissions;
  if (!Array.isArray(layers)) return [];

  const acc: string[] = [];
  for (const entry of layers) {
    const entryOrg = entry?.organizationId ?? entry?.organization_id;
    if (orgId == null || entryOrg === orgId) {
      for (const p of coercePermissions(entry?.permissions)) acc.push(p);
    }
  }
  return acc;
}

/** The allow set contributed by a single user_role row (legacy ∪ granted ∪ role). */
export function rowAllowPermissions(ur: any): string[] {
  if (!ur) return [];
  return [
    ...coercePermissions(ur.permissions),
    ...coercePermissions(ur.grantedPermissions ?? ur.granted_permissions),
    ...rowRolePermissions(ur),
  ];
}

/** The deny set contributed by a single user_role row. */
export function rowDeniedPermissions(ur: any): string[] {
  if (!ur) return [];
  return coercePermissions(ur.deniedPermissions ?? ur.denied_permissions);
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
 * Resolve the ALLOW permissions granted to a user in an organization context.
 * Tenant context → unions every user_roles entry's (legacy ∪ granted ∪ role
 *                  layer) for the org.
 * No org context → the user's top-level permissions ∪ grantedPermissions.
 */
export function resolveUserPermissions(user: any, organizationId?: number | string | null): string[] {
  if (!user) return [];
  // Group-membership enforcement (design §6): when the membership layer has
  // resolved the matching row(s), the permission source switches to that row
  // only. The guard attaches the resolved ALLOW list as `__membershipPermissions`.
  // Absent (enforcement off) → fall through to the legacy heuristic, so existing
  // behavior is byte-for-byte unchanged.
  if (Array.isArray(user.__membershipPermissions)) {
    return coercePermissions(user.__membershipPermissions);
  }
  if (organizationId != null) {
    const userRoles = user.userRoles ?? user.user_roles ?? [];
    const all: string[] = [];
    for (const ur of userRoles) {
      if (readOrgId(ur) === organizationId) {
        for (const p of rowAllowPermissions(ur)) all.push(p);
      }
    }
    return all;
  }
  return [
    ...coercePermissions(user.permissions),
    ...coercePermissions(user.grantedPermissions ?? user.granted_permissions),
  ];
}

/**
 * Resolve the DENY permissions for a user in an organization context. Deny
 * always wins over the allow set.
 */
export function resolveDeniedPermissions(user: any, organizationId?: number | string | null): string[] {
  if (!user) return [];
  if (Array.isArray(user.__membershipDeniedPermissions)) {
    return coercePermissions(user.__membershipDeniedPermissions);
  }
  if (organizationId != null) {
    const userRoles = user.userRoles ?? user.user_roles ?? [];
    const all: string[] = [];
    for (const ur of userRoles) {
      if (readOrgId(ur) === organizationId) {
        for (const p of rowDeniedPermissions(ur)) all.push(p);
      }
    }
    return all;
  }
  return coercePermissions(user.deniedPermissions ?? user.denied_permissions);
}

/**
 * Top-level permission check mirroring the Laravel `hasPermission` method.
 * Applies deny-overrides: a denied permission is denied even under a role `*`.
 */
export function userHasPermission(
  user: any,
  permission: string,
  organization?: { id: number | string } | null,
): boolean {
  if (!user) return false;
  const orgId = organization ? organization.id : null;

  // Deny always wins.
  if (matchesPermission(permission, resolveDeniedPermissions(user, orgId))) return false;

  return matchesPermission(permission, resolveUserPermissions(user, orgId));
}
