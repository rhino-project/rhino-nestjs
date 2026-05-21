import { SerializerService } from './serializer.service';
import { ResourcePolicy } from '../policies/resource-policy';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

describe('SerializerService', () => {
  let s: SerializerService;
  beforeEach(() => (s = new SerializerService()));

  it('returns null for null record', () => {
    expect(s.serializeOne(null as any, { model: 'x' })).toBeNull();
  });

  it('strips base hidden columns (camel and snake)', () => {
    const record = {
      id: 1,
      name: 'A',
      password: 'secret',
      rememberToken: 'x',
      remember_token: 'x',
      createdAt: new Date(),
      deletedAt: null,
      updatedAt: new Date(),
    };
    const reg: ModelRegistration = { model: 'user' };
    const out = s.serializeOne(record, reg);
    expect(out).toEqual({ id: 1, name: 'A' });
  });

  it('strips additionalHiddenColumns', () => {
    const record = { id: 1, name: 'A', secret: 'x' };
    const reg: ModelRegistration = { model: 'user', additionalHiddenColumns: ['secret'] };
    const out = s.serializeOne(record, reg);
    expect(out).toEqual({ id: 1, name: 'A' });
  });

  it('applies policy blacklist via hiddenAttributesForShow', () => {
    class P extends ResourcePolicy {
      hiddenAttributesForShow() {
        return ['internal'];
      }
    }
    const record = { id: 1, name: 'A', internal: 'x' };
    const reg: ModelRegistration = { model: 'post', policy: P };
    const out = s.serializeOne(record, reg);
    expect(out).toEqual({ id: 1, name: 'A' });
  });

  it('applies policy whitelist but always keeps id', () => {
    class P extends ResourcePolicy {
      permittedAttributesForShow() {
        return ['name'];
      }
    }
    const record = { id: 7, name: 'A', internal: 'x' };
    const reg: ModelRegistration = { model: 'post', policy: P };
    const out = s.serializeOne(record, reg);
    expect(out).toEqual({ id: 7, name: 'A' });
  });

  it('merges computed attributes before filtering', () => {
    class P extends ResourcePolicy {
      permittedAttributesForShow() {
        return ['fullName'];
      }
    }
    const reg: ModelRegistration = {
      model: 'user',
      policy: P,
      computedAttributes: (r) => ({ fullName: `${r.first} ${r.last}` }),
    };
    const out = s.serializeOne({ id: 1, first: 'A', last: 'B' }, reg);
    expect(out).toEqual({ id: 1, fullName: 'A B' });
  });

  it('wildcard permitted keeps everything', () => {
    class P extends ResourcePolicy {
      permittedAttributesForShow() {
        return ['*'];
      }
    }
    const reg: ModelRegistration = { model: 'x', policy: P };
    const out = s.serializeOne({ id: 1, a: 1, b: 2 }, reg);
    expect(out).toEqual({ id: 1, a: 1, b: 2 });
  });

  it('serializeMany applies to each record', () => {
    const reg: ModelRegistration = { model: 'x' };
    const out = s.serializeMany(
      [
        { id: 1, password: 'x' },
        { id: 2, password: 'y' },
      ],
      reg,
    );
    expect(out).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('hiddenAttributesForShow applied before permittedAttributesForShow (blacklist wins over whitelist)', () => {
    class P extends ResourcePolicy {
      hiddenAttributesForShow() {
        return ['internal'];
      }
      permittedAttributesForShow() {
        return ['internal', 'name'];
      }
    }
    const reg: ModelRegistration = { model: 'x', policy: P };
    const out = s.serializeOne({ id: 1, name: 'A', internal: 'x' }, reg);
    expect(out).toEqual({ id: 1, name: 'A' });
  });

  // -------------------------------------------------------------------
  // BP-007: SerializerService passes `org` to policy attribute methods
  // -------------------------------------------------------------------
  describe('BP-007: org is passed to policy attribute methods', () => {
    // Realistic policy mirroring what blueprint generators emit
    class RoleKeyedPolicy extends ResourcePolicy {
      permittedAttributesForShow(user: any, org?: any): string[] {
        if (this.hasRole(user, 'admin', org)) return ['*'];
        if (this.hasRole(user, 'manager', org)) return ['id', 'title', 'budget'];
        if (this.hasRole(user, 'viewer', org)) return ['id', 'title'];
        return [];
      }
      hiddenAttributesForShow(user: any, org?: any): string[] {
        if (this.hasRole(user, 'manager', org)) return ['internalNotes'];
        if (this.hasRole(user, 'viewer', org)) return ['budget', 'internalNotes'];
        return [];
      }
    }

    const reg: ModelRegistration = { model: 'project', policy: RoleKeyedPolicy };

    const makeUser = (orgId: number, roleSlug: string) => ({
      id: 1,
      userRoles: [{ organizationId: orgId, role: { slug: roleSlug }, permissions: ['*'] }],
    });

    const fullRecord = {
      id: 1,
      title: 'Website',
      budget: 50000,
      internalNotes: 'sensitive',
      description: 'x',
    };

    it('admin (role resolved via org) sees the full record', () => {
      const user = makeUser(1, 'admin');
      const out = s.serializeOne(fullRecord, reg, { user, organization: { id: 1 } });
      expect(out).toEqual(fullRecord);
    });

    it('manager sees budget but not internalNotes', () => {
      const user = makeUser(1, 'manager');
      const out = s.serializeOne(fullRecord, reg, { user, organization: { id: 1 } });
      expect(out).toEqual({ id: 1, title: 'Website', budget: 50000 });
    });

    it('viewer sees only id + title', () => {
      const user = makeUser(1, 'viewer');
      const out = s.serializeOne(fullRecord, reg, { user, organization: { id: 1 } });
      expect(out).toEqual({ id: 1, title: 'Website' });
    });

    it('user in a DIFFERENT org collapses to no role → empty (id only)', () => {
      const user = makeUser(2, 'admin'); // admin in org 2, but serialization context is org 1
      const out = s.serializeOne(fullRecord, reg, { user, organization: { id: 1 } });
      expect(out).toEqual({ id: 1 });
    });

    it('serializeMany threads the same ctx to every record', () => {
      const user = makeUser(1, 'viewer');
      const records = [
        { id: 1, title: 'A', budget: 100, internalNotes: 'x' },
        { id: 2, title: 'B', budget: 200, internalNotes: 'y' },
      ];
      const out = s.serializeMany(records, reg, { user, organization: { id: 1 } });
      expect(out).toEqual([
        { id: 1, title: 'A' },
        { id: 2, title: 'B' },
      ]);
    });

    it('legacy call shape (bare user, no org) still works with non-org-dependent policies', () => {
      class SimplePolicy extends ResourcePolicy {
        permittedAttributesForShow(_user: any): string[] {
          return ['title'];
        }
      }
      const out = s.serializeOne(fullRecord, { model: 'x', policy: SimplePolicy }, { id: 99 });
      expect(out).toEqual({ id: 1, title: 'Website' });
    });

    it('legacy bare-user call produces empty (id only) with role-keyed policy (documents the BP-007 pre-fix failure mode)', () => {
      const user = makeUser(1, 'admin');
      // Pre-BP-007 call shape: no org. Role resolution needs org → returns [].
      const out = s.serializeOne(fullRecord, reg, user);
      expect(out).toEqual({ id: 1 });
    });

    it('omitting ctx entirely returns full data when there is no policy', () => {
      const out = s.serializeOne(
        { id: 1, a: 1, b: 2 },
        { model: 'x' }, // no policy
      );
      expect(out).toEqual({ id: 1, a: 1, b: 2 });
    });
  });
});
