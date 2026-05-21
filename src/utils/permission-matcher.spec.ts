import {
  coercePermissions,
  matchesPermission,
  resolveUserRoleSlug,
  resolveUserPermissions,
  userHasPermission,
} from './permission-matcher';

describe('matchesPermission', () => {
  it('returns false when granted list is empty or null', () => {
    expect(matchesPermission('posts.index', [])).toBe(false);
    expect(matchesPermission('posts.index', null as any)).toBe(false);
    expect(matchesPermission('posts.index', undefined as any)).toBe(false);
  });

  it('matches exact permission', () => {
    expect(matchesPermission('posts.index', ['posts.index'])).toBe(true);
    expect(matchesPermission('posts.index', ['posts.show'])).toBe(false);
  });

  it('matches global wildcard *', () => {
    expect(matchesPermission('posts.index', ['*'])).toBe(true);
    expect(matchesPermission('anything.else', ['*'])).toBe(true);
  });

  it('matches slug wildcard {slug}.*', () => {
    expect(matchesPermission('posts.index', ['posts.*'])).toBe(true);
    expect(matchesPermission('posts.show', ['posts.*'])).toBe(true);
    expect(matchesPermission('comments.index', ['posts.*'])).toBe(false);
  });

  it('does not cross-match unrelated slugs', () => {
    expect(matchesPermission('posts.index', ['comments.index', 'tags.*'])).toBe(false);
  });

  it('handles permission without a slug gracefully', () => {
    expect(matchesPermission('wat', ['wat'])).toBe(true);
    expect(matchesPermission('wat', ['*'])).toBe(true);
  });
});

describe('resolveUserPermissions', () => {
  it('returns empty array for null user', () => {
    expect(resolveUserPermissions(null, 1)).toEqual([]);
  });

  it('returns user.permissions when no org context', () => {
    const user = { permissions: ['posts.index'] };
    expect(resolveUserPermissions(user)).toEqual(['posts.index']);
  });

  it('aggregates tenant permissions from userRoles for the org', () => {
    const user = {
      userRoles: [
        { organizationId: 1, permissions: ['posts.*'] },
        { organizationId: 2, permissions: ['comments.index'] },
      ],
    };
    expect(resolveUserPermissions(user, 1)).toEqual(['posts.*']);
    expect(resolveUserPermissions(user, 2)).toEqual(['comments.index']);
    expect(resolveUserPermissions(user, 3)).toEqual([]);
  });

  it('supports snake_case userRoles shape', () => {
    const user = {
      user_roles: [{ organization_id: 5, permissions: ['x.*'] }],
    };
    expect(resolveUserPermissions(user, 5)).toEqual(['x.*']);
  });
});

describe('userHasPermission', () => {
  it('returns false for null user', () => {
    expect(userHasPermission(null, 'posts.index')).toBe(false);
  });

  it('checks non-tenant permissions from user.permissions', () => {
    const user = { permissions: ['posts.index'] };
    expect(userHasPermission(user, 'posts.index')).toBe(true);
    expect(userHasPermission(user, 'posts.show')).toBe(false);
  });

  it('checks tenant permissions from userRoles', () => {
    const user = {
      userRoles: [{ organizationId: 10, permissions: ['posts.*'] }],
    };
    expect(userHasPermission(user, 'posts.show', { id: 10 })).toBe(true);
    expect(userHasPermission(user, 'posts.show', { id: 99 })).toBe(false);
  });

  it('does not leak permissions across organizations', () => {
    const user = {
      userRoles: [
        { organizationId: 1, permissions: ['*'] },
        { organizationId: 2, permissions: [] },
      ],
    };
    expect(userHasPermission(user, 'posts.index', { id: 2 })).toBe(false);
  });
});

// -------------------------------------------------------------------------
// BP-008: JSON-string / comma-separated permissions (SQLite, older MySQL)
// -------------------------------------------------------------------------
describe('BP-008: coercePermissions', () => {
  it('passes arrays through unchanged', () => {
    expect(coercePermissions(['a.b', 'c.d'])).toEqual(['a.b', 'c.d']);
    expect(coercePermissions([])).toEqual([]);
  });

  it('parses JSON-array strings', () => {
    expect(coercePermissions('["posts.index","posts.show"]')).toEqual(['posts.index', 'posts.show']);
    expect(coercePermissions('["*"]')).toEqual(['*']);
    expect(coercePermissions('[]')).toEqual([]);
  });

  it('tolerates whitespace around JSON strings', () => {
    expect(coercePermissions('  ["a"]  ')).toEqual(['a']);
  });

  it('splits comma-separated strings', () => {
    expect(coercePermissions('posts.index, posts.show, comments.*')).toEqual([
      'posts.index',
      'posts.show',
      'comments.*',
    ]);
  });

  it('handles a single bare value (no comma)', () => {
    expect(coercePermissions('posts.index')).toEqual(['posts.index']);
  });

  it('returns empty for null / undefined / empty / non-string non-array', () => {
    expect(coercePermissions(null)).toEqual([]);
    expect(coercePermissions(undefined)).toEqual([]);
    expect(coercePermissions('')).toEqual([]);
    expect(coercePermissions('   ')).toEqual([]);
    expect(coercePermissions(123)).toEqual([]);
    expect(coercePermissions({})).toEqual([]);
  });

  it('falls back to comma-split on malformed JSON', () => {
    expect(coercePermissions('[bad json')).toEqual(['[bad json']);
    expect(coercePermissions('[not, valid')).toEqual(['[not', 'valid']);
  });

  it('coerces non-string JSON array entries to strings', () => {
    expect(coercePermissions('[1,2,3]')).toEqual(['1', '2', '3']);
  });
});

describe('BP-008: matchesPermission accepts string inputs', () => {
  it('matches when granted is a JSON-string array', () => {
    expect(matchesPermission('posts.index', '["posts.index","posts.show"]')).toBe(true);
    expect(matchesPermission('comments.store', '["posts.*"]')).toBe(false);
  });

  it('matches wildcards from a JSON-string', () => {
    expect(matchesPermission('anything.else', '["*"]')).toBe(true);
    expect(matchesPermission('posts.destroy', '["posts.*"]')).toBe(true);
  });

  it('matches from a comma-separated string', () => {
    expect(matchesPermission('posts.index', 'posts.index, comments.*')).toBe(true);
  });

  it('still supports actual arrays (backwards compat)', () => {
    expect(matchesPermission('posts.index', ['posts.index'])).toBe(true);
  });
});

describe('BP-008: resolveUserPermissions handles JSON-string columns', () => {
  it('parses ur.permissions when stored as a JSON string (SQLite pattern)', () => {
    const user = {
      userRoles: [
        {
          organizationId: 1,
          permissions: '["projects.index","projects.show","tasks.*"]',
        },
      ],
    };
    expect(resolveUserPermissions(user, 1)).toEqual(['projects.index', 'projects.show', 'tasks.*']);
  });

  it('parses user.permissions when stored as a JSON string (non-tenant)', () => {
    const user = { permissions: '["*"]' };
    expect(resolveUserPermissions(user)).toEqual(['*']);
  });

  it('mixes string and array shapes across userRoles', () => {
    const user = {
      userRoles: [
        { organizationId: 1, permissions: '["a.*"]' },
        { organizationId: 1, permissions: ['b.*'] },
      ],
    };
    expect(resolveUserPermissions(user, 1).sort()).toEqual(['a.*', 'b.*']);
  });
});

describe('BP-008: userHasPermission with JSON-string stored permissions', () => {
  it('passes end-to-end: seeded viewer with JSON-string permissions can index projects', () => {
    // Reproduces PRD seed shape: bcrypt-authed user, permissions JSON-encoded
    const dave = {
      id: 4,
      userRoles: [
        {
          organizationId: 1,
          role: { slug: 'viewer' },
          permissions:
            '["projects.index","projects.show","tasks.index","tasks.show","comments.index","comments.show"]',
        },
      ],
    };

    expect(userHasPermission(dave, 'projects.index', { id: 1 })).toBe(true);
    expect(userHasPermission(dave, 'projects.show', { id: 1 })).toBe(true);
    // Should NOT have store
    expect(userHasPermission(dave, 'projects.store', { id: 1 })).toBe(false);
    // Other org → no permissions leak
    expect(userHasPermission(dave, 'projects.index', { id: 99 })).toBe(false);
  });

  it('admin wildcard via JSON string grants everything in-org', () => {
    const alice = {
      id: 1,
      userRoles: [{ organizationId: 1, role: { slug: 'admin' }, permissions: '["*"]' }],
    };
    expect(userHasPermission(alice, 'projects.destroy', { id: 1 })).toBe(true);
    expect(userHasPermission(alice, 'comments.forceDelete', { id: 1 })).toBe(true);
  });
});

describe('resolveUserRoleSlug', () => {
  it('returns null with no org', () => {
    expect(resolveUserRoleSlug({}, null)).toBeNull();
  });

  it('returns the matching role slug', () => {
    const user = {
      userRoles: [
        { organizationId: 1, role: { slug: 'admin' } },
        { organizationId: 2, role: { slug: 'viewer' } },
      ],
    };
    expect(resolveUserRoleSlug(user, 1)).toBe('admin');
    expect(resolveUserRoleSlug(user, 2)).toBe('viewer');
    expect(resolveUserRoleSlug(user, 3)).toBeNull();
  });
});
