import { Injectable } from '@nestjs/common';
import { RhinoConfigService } from '../rhino.config';
import { rowAllowPermissions, rowDeniedPermissions } from '../utils/permission-matcher';

/**
 * A single `user_roles` membership row, normalized across snake_case /
 * camelCase shapes (Prisma vs raw SQL). `routeGroup === null` is a WILDCARD
 * (Decision 9.B) — the row is a member of every group.
 */
export interface MembershipRow {
  routeGroup: string | null;
  organizationId: number | string | null;
  permissions: unknown;
  grantedPermissions?: unknown;
  deniedPermissions?: unknown;
  role?: any;
}

function readRouteGroup(ur: any): string | null {
  const v = ur.routeGroup ?? ur.route_group;
  return v == null ? null : String(v);
}

function readOrgId(ur: any): number | string | null {
  const v = ur.organizationId ?? ur.organization_id;
  return v == null ? null : v;
}

/**
 * Membership enforcement & permission resolution (design §6).
 *
 * Gated entirely by `auth.enforceGroupMembership`:
 *  - OFF (default): {@link enabled} is `false`; callers skip every check and
 *    fall back to the legacy org-presence heuristic. Behavior is unchanged.
 *  - ON: a user must hold a `user_roles` row whose `route_group` matches the
 *    request's group (a NULL row is a wildcard) and — for tenant groups — whose
 *    organization matches the resolved org. Permissions then resolve from that
 *    matched row only.
 *
 * Membership is a COARSE gate (may you enter the group); the ResourcePolicy
 * remains the FINE check. They run in sequence and are never merged.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly config: RhinoConfigService) {}

  /** Whether membership enforcement is active at all. */
  enabled(): boolean {
    return this.config.enforceGroupMembership();
  }

  private userRoles(user: any): any[] {
    if (!user) return [];
    return user.userRoles ?? user.user_roles ?? [];
  }

  /**
   * Find the membership rows that admit `user` into `routeGroup` for the given
   * organization. A row matches when:
   *   - its `route_group` is NULL (wildcard) OR equals `routeGroup`, AND
   *   - for tenant groups, its organization equals the resolved org's id
   *     (NULL-org wildcard rows still match); for non-tenant groups the org is
   *     ignored entirely.
   */
  matchingRows(
    user: any,
    routeGroup: string | null | undefined,
    organization: { id: number | string } | null | undefined,
    isTenant: boolean,
  ): MembershipRow[] {
    const group = routeGroup == null ? null : String(routeGroup);
    const orgId = organization?.id ?? null;
    const rows: MembershipRow[] = [];
    for (const ur of this.userRoles(user)) {
      const rowGroup = readRouteGroup(ur);
      // route_group gate: NULL row is a wildcard, else must equal the group.
      if (rowGroup !== null && group !== null && rowGroup !== group) continue;
      // (a concrete group request with a non-matching concrete row is rejected
      // above; a NULL request — legacy/global — matches any row.)
      const rowOrg = readOrgId(ur);
      if (isTenant && orgId != null) {
        // Tenant group with a resolved org: the row must target that org, or be
        // an org-wildcard (NULL org) row.
        if (rowOrg !== null && rowOrg !== orgId) continue;
      }
      // Non-tenant group: org is ignored.
      rows.push({
        routeGroup: rowGroup,
        organizationId: rowOrg,
        permissions: ur.permissions,
        grantedPermissions: ur.grantedPermissions ?? ur.granted_permissions,
        deniedPermissions: ur.deniedPermissions ?? ur.denied_permissions,
        role: ur.role,
      });
    }
    return rows;
  }

  /**
   * Whether `user` is a member of `routeGroup` (for the resolved org, when the
   * group is a tenant group). Only meaningful when {@link enabled}.
   */
  isMember(
    user: any,
    routeGroup: string | null | undefined,
    organization: { id: number | string } | null | undefined,
    isTenant: boolean,
  ): boolean {
    return this.matchingRows(user, routeGroup, organization, isTenant).length > 0;
  }

  /**
   * ALLOW permissions resolved from the matched membership rows only
   * (design §6: "permissions then resolve from that matching membership row").
   * Layered: each row contributes legacy ∪ granted ∪ org role layer.
   */
  permissionsFromRows(rows: MembershipRow[]): string[] {
    const out: string[] = [];
    for (const r of rows) {
      for (const p of rowAllowPermissions(r)) out.push(p);
    }
    return out;
  }

  /**
   * DENY permissions resolved from the matched membership rows. Deny always
   * wins over the allow set ({@link permissionsFromRows}).
   */
  deniedFromRows(rows: MembershipRow[]): string[] {
    const out: string[] = [];
    for (const r of rows) {
      for (const p of rowDeniedPermissions(r)) out.push(p);
    }
    return out;
  }
}
