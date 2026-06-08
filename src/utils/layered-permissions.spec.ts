import {
  userHasPermission,
  resolveUserPermissions,
  resolveDeniedPermissions,
} from './permission-matcher';

/**
 * Layered permissions: effective = (role ∪ granted) − denied, deny always wins.
 *
 *   - role    → org_role_permissions[(org, role)].permissions   (shared role layer)
 *   - granted → user_roles.granted_permissions                  (per-user additive)
 *   - denied  → user_roles.denied_permissions                   (per-user subtractive)
 *   - legacy  → user_roles.permissions                          (back-compat allow)
 *
 * The role layer reaches the matcher as `role.orgRolePermissions` (Prisma deep
 * include), scoped to the row's organization.
 *
 * See PERMISSIONS_DESIGN.md §4 for the cross-stack conformance truth table.
 */

const ORG = 1;

// Build a user whose single user_role for ORG carries the given layers.
function user({
  role,
  granted = [],
  denied = [],
  legacy = [],
}: {
  role?: string[];
  granted?: string[];
  denied?: string[];
  legacy?: string[];
}) {
  return {
    id: 1,
    userRoles: [
      {
        organizationId: ORG,
        roleId: 7,
        permissions: legacy,
        grantedPermissions: granted,
        deniedPermissions: denied,
        role:
          role === undefined
            ? { id: 7 }
            : { id: 7, orgRolePermissions: [{ organizationId: ORG, permissions: role }] },
      },
    ],
  };
}

function can(layers: Parameters<typeof user>[0], permission: string): boolean {
  return userHasPermission(user(layers), permission, { id: ORG });
}

describe('layered permissions — truth table (PERMISSIONS_DESIGN.md §4)', () => {
  const cases: Array<[string, Parameters<typeof user>[0], string, boolean]> = [
    ['default deny', { role: [], granted: [], denied: [] }, 'posts.update', false],
    ['role grants', { role: ['posts.*'] }, 'posts.update', true],
    ['grant grants', { granted: ['posts.update'] }, 'posts.update', true],
    ['deny over role', { role: ['posts.*'], denied: ['posts.update'] }, 'posts.update', false],
    ['deny over superadmin', { role: ['*'], denied: ['posts.update'] }, 'posts.update', false],
    ['deny wildcard hits', { role: ['*'], denied: ['posts.*'] }, 'posts.index', false],
    ['deny wildcard scoped', { role: ['*'], denied: ['posts.*'] }, 'users.index', true],
    ['grant adds to role', { role: ['posts.index'], granted: ['posts.update'] }, 'posts.update', true],
    ['still inherits role', { role: ['posts.index'], granted: ['posts.update'] }, 'posts.index', true],
    ['not granted anywhere', { role: ['posts.*'] }, 'comments.update', false],
    ['deny over grant wildcard', { granted: ['*'], denied: ['posts.*'] }, 'posts.update', false],
    ['grant wildcard else allowed', { granted: ['*'], denied: ['posts.*'] }, 'comments.index', true],
  ];

  it.each(cases)('%s → %s = %s', (_name, layers, permission, expected) => {
    expect(can(layers, permission)).toBe(expected);
  });
});

describe('layered permissions — edge cases', () => {
  it('follows deny when the same ability is granted and denied', () => {
    expect(can({ granted: ['posts.update'], denied: ['posts.update'] }, 'posts.update')).toBe(false);
  });

  it('only blocks the denied ability within a granted wildcard', () => {
    const u = user({ granted: ['posts.*'], denied: ['posts.destroy'] });
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.index', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: ORG })).toBe(false);
  });

  it('unions the user grant with the role layer (does not replace it)', () => {
    const u = user({ role: ['posts.index', 'posts.show'], granted: ['posts.update'] });
    expect(userHasPermission(u, 'posts.index', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.show', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: ORG })).toBe(false);
  });

  it('lets a user-level deny override the role layer', () => {
    const u = user({ role: ['*'], denied: ['posts.destroy'] });
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: ORG })).toBe(false);
    expect(userHasPermission(u, 'users.index', { id: ORG })).toBe(true);
  });

  it('grants from the role layer alone with no user permissions', () => {
    const u = user({ role: ['posts.*', 'comments.index'] });
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'comments.index', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'comments.store', { id: ORG })).toBe(false);
  });
});

describe('layered permissions — backward compatibility', () => {
  it('honors legacy user_roles.permissions with no role layer', () => {
    const u = user({ legacy: ['posts.index', 'posts.show'] });
    expect(userHasPermission(u, 'posts.index', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(false);
  });

  it('lets a deny carve out of a legacy wildcard', () => {
    const u = user({ legacy: ['*'], denied: ['posts.destroy'] });
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: ORG })).toBe(false);
  });

  it('degrades to legacy when the role has no orgRolePermissions relation', () => {
    // role present but no orgRolePermissions array (un-migrated Prisma schema).
    const u = {
      userRoles: [{ organizationId: ORG, permissions: ['posts.index'], role: { id: 7 } }],
    };
    expect(userHasPermission(u, 'posts.index', { id: ORG })).toBe(true);
    expect(userHasPermission(u, 'posts.update', { id: ORG })).toBe(false);
  });
});

describe('layered permissions — isolation', () => {
  it('scopes the role layer to the row organization', () => {
    // Role 7 has org_role_permissions in BOTH orgs; the matcher must pick the
    // entry matching the user_role's own organization.
    const u = {
      userRoles: [
        {
          organizationId: 1,
          role: {
            id: 7,
            orgRolePermissions: [
              { organizationId: 1, permissions: ['posts.index'] },
              { organizationId: 2, permissions: ['*'] },
            ],
          },
        },
      ],
    };
    expect(userHasPermission(u, 'posts.index', { id: 1 })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: 1 })).toBe(false);
  });

  it('does not aggregate permissions from a different org', () => {
    const u = {
      userRoles: [
        { organizationId: 1, permissions: ['posts.*'] },
        { organizationId: 2, permissions: ['*'] },
      ],
    };
    expect(userHasPermission(u, 'posts.index', { id: 1 })).toBe(true);
    expect(userHasPermission(u, 'comments.index', { id: 1 })).toBe(false);
  });
});

describe('layered permissions — non-tenant + membership-enforced source', () => {
  it('uses top-level permissions when no org context', () => {
    const u = { permissions: ['posts.index'] };
    expect(userHasPermission(u, 'posts.index')).toBe(true);
    expect(userHasPermission(u, 'posts.store')).toBe(false);
  });

  it('lets a top-level deny override top-level permissions', () => {
    const u = { permissions: ['*'], deniedPermissions: ['posts.destroy'] };
    expect(userHasPermission(u, 'posts.update')).toBe(true);
    expect(userHasPermission(u, 'posts.destroy')).toBe(false);
  });

  it('honors the membership-enforced allow/deny source over the heuristic', () => {
    const u = {
      __membershipPermissions: ['posts.*'],
      __membershipDeniedPermissions: ['posts.destroy'],
      // A broader userRoles set that must be ignored when enforcement resolved.
      userRoles: [{ organizationId: 1, permissions: ['*'] }],
    };
    expect(resolveUserPermissions(u, 1)).toEqual(['posts.*']);
    expect(resolveDeniedPermissions(u, 1)).toEqual(['posts.destroy']);
    expect(userHasPermission(u, 'posts.update', { id: 1 })).toBe(true);
    expect(userHasPermission(u, 'posts.destroy', { id: 1 })).toBe(false);
  });
});
