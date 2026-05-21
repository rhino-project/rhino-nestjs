import { ResourcePolicy } from './resource-policy';

function makeUser(permissions: string[], orgId = 1) {
  return {
    id: 1,
    userRoles: [{ organizationId: orgId, permissions, role: { slug: 'admin' } }],
  };
}

describe('ResourcePolicy', () => {
  it('denies when no user', () => {
    const p = new ResourcePolicy();
    p.resourceSlug = 'posts';
    expect(p.viewAny(null)).toBe(false);
    expect(p.view(null, {})).toBe(false);
  });

  it('denies when resourceSlug missing', () => {
    const p = new ResourcePolicy();
    expect(p.viewAny(makeUser(['*']))).toBe(false);
  });

  it('checks `{slug}.{action}` against tenant permissions', () => {
    const p = new ResourcePolicy();
    p.resourceSlug = 'posts';
    const user = makeUser(['posts.index']);
    const org = { id: 1 };
    expect(p.viewAny(user, org)).toBe(true);
    expect(p.view(user, {}, org)).toBe(false);
  });

  it('honors wildcards', () => {
    const p = new ResourcePolicy();
    p.resourceSlug = 'posts';
    const org = { id: 1 };
    expect(p.update(makeUser(['*']), {}, org)).toBe(true);
    expect(p.delete(makeUser(['posts.*']), {}, org)).toBe(true);
  });

  it('isolates permissions by organization', () => {
    const p = new ResourcePolicy();
    p.resourceSlug = 'posts';
    const user = {
      userRoles: [
        { organizationId: 1, permissions: ['*'] },
        { organizationId: 2, permissions: [] },
      ],
    };
    expect(p.viewAny(user, { id: 1 })).toBe(true);
    expect(p.viewAny(user, { id: 2 })).toBe(false);
  });

  it('covers soft-delete actions with discrete permissions', () => {
    const p = new ResourcePolicy();
    p.resourceSlug = 'posts';
    const user = makeUser(['posts.trashed', 'posts.restore']);
    const org = { id: 1 };
    expect(p.viewTrashed(user, org)).toBe(true);
    expect(p.restore(user, {}, org)).toBe(true);
    expect(p.forceDelete(user, {}, org)).toBe(false);
  });

  it('has [*] defaults for attribute permissions', () => {
    const p = new ResourcePolicy();
    expect(p.permittedAttributesForShow({})).toEqual(['*']);
    expect(p.permittedAttributesForCreate({})).toEqual(['*']);
    expect(p.permittedAttributesForUpdate({})).toEqual(['*']);
    expect(p.hiddenAttributesForShow({})).toEqual([]);
  });

  it('hasRole helper resolves from userRoles', () => {
    class SubPolicy extends ResourcePolicy {
      isAdmin(user: any, org: any) {
        return this.hasRole(user, 'admin', org);
      }
    }
    const p = new SubPolicy();
    expect(p.isAdmin(makeUser([], 7), { id: 7 })).toBe(true);
    expect(p.isAdmin(makeUser([], 7), { id: 8 })).toBe(false);
  });
});
