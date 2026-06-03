import { MembershipService } from './membership.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

function svc(cfg: Partial<RhinoConfig> = {}): MembershipService {
  const config = new RhinoConfigService(
    normalizeConfig({ models: {}, ...cfg } as RhinoConfig),
  );
  return new MembershipService(config);
}

function user(rows: any[]) {
  return { id: 1, userRoles: rows };
}

describe('MembershipService', () => {
  describe('enabled()', () => {
    it('is false by default (flag off)', () => {
      expect(svc().enabled()).toBe(false);
    });
    it('is true when enforceGroupMembership is on', () => {
      expect(svc({ auth: { enforceGroupMembership: true } }).enabled()).toBe(true);
    });
  });

  describe('matchingRows — route_group gate', () => {
    it('a concrete row matches its own group', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'driver', organizationId: null, permissions: ['a'] }]),
        'driver',
        null,
        false,
      );
      expect(rows).toHaveLength(1);
    });

    it('a concrete row does NOT match a different group (403 path)', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'admin', organizationId: null, permissions: [] }]),
        'driver',
        null,
        false,
      );
      expect(rows).toHaveLength(0);
    });

    it('a NULL row is a wildcard — matches any group (Decision 9.B)', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: null, organizationId: null, permissions: ['x'] }]),
        'driver',
        null,
        false,
      );
      expect(rows).toHaveLength(1);
    });

    it('snake_case route_group / organization_id are read', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ route_group: 'driver', organization_id: 7, permissions: [] }]),
        'driver',
        { id: 7 },
        true,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('matchingRows — tenant org gate', () => {
    it('tenant group requires the org to match', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'tenant', organizationId: 2, permissions: [] }]),
        'tenant',
        { id: 1 },
        true,
      );
      expect(rows).toHaveLength(0);
    });

    it('tenant group matches when org matches', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'tenant', organizationId: 1, permissions: [] }]),
        'tenant',
        { id: 1 },
        true,
      );
      expect(rows).toHaveLength(1);
    });

    it('a NULL-org row is an org-wildcard for tenant groups', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'tenant', organizationId: null, permissions: [] }]),
        'tenant',
        { id: 99 },
        true,
      );
      expect(rows).toHaveLength(1);
    });

    it('non-tenant group ignores org entirely', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: 'admin', organizationId: 5, permissions: [] }]),
        'admin',
        { id: 1 },
        false,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('permissionsFromRows', () => {
    it('aggregates permissions from matched rows only', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([
          { routeGroup: 'driver', organizationId: null, permissions: ['trips.index'] },
          { routeGroup: 'admin', organizationId: null, permissions: ['users.*'] },
        ]),
        'driver',
        null,
        false,
      );
      expect(s.permissionsFromRows(rows)).toEqual(['trips.index']);
    });

    it('coerces JSON-string permissions (BP-008)', () => {
      const s = svc();
      const rows = s.matchingRows(
        user([{ routeGroup: null, organizationId: null, permissions: '["a","b"]' }]),
        'x',
        null,
        false,
      );
      expect(s.permissionsFromRows(rows)).toEqual(['a', 'b']);
    });
  });

  describe('isMember', () => {
    it('true when a matching row exists', () => {
      const s = svc();
      expect(
        s.isMember(user([{ routeGroup: 'driver', permissions: [] }]), 'driver', null, false),
      ).toBe(true);
    });
    it('false when no matching row exists', () => {
      const s = svc();
      expect(
        s.isMember(user([{ routeGroup: 'admin', permissions: [] }]), 'driver', null, false),
      ).toBe(false);
    });
    it('false for a user with no roles', () => {
      const s = svc();
      expect(s.isMember(user([]), 'driver', null, false)).toBe(false);
    });
  });
});
