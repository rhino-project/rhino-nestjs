import { OrganizationService } from './organization.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';
import { NotFoundException } from '@nestjs/common';

function setup(
  orgs: any[],
  memberships: any[] = [],
  mt: any = { organizationIdentifierColumn: 'slug' },
  authCfg: any = undefined,
) {
  const organization = {
    findFirst: jest.fn().mockImplementation(({ where }) => {
      return Promise.resolve(orgs.find((o) => Object.entries(where).every(([k, v]) => o[k] === v)) ?? null);
    }),
  };
  const userRole = {
    findFirst: jest.fn().mockImplementation(({ where }) => {
      return Promise.resolve(
        memberships.find((m) => m.userId === where.userId && m.organizationId === where.organizationId) ?? null,
      );
    }),
  };
  const prisma = new PrismaService({ organization, userRole });
  const config = new RhinoConfigService(
    normalizeConfig({ models: {}, multiTenant: mt, ...(authCfg ? { auth: authCfg } : {}) }),
  );
  return new OrganizationService(prisma, config);
}

describe('OrganizationService', () => {
  it('resolves by slug', async () => {
    const svc = setup([{ id: 1, slug: 'acme' }]);
    const org = await svc.resolve('acme');
    expect(org.slug).toBe('acme');
  });

  it('throws NotFound when org missing', async () => {
    const svc = setup([]);
    await expect(svc.resolve('missing')).rejects.toThrow(NotFoundException);
  });

  it('throws when user not a member', async () => {
    const svc = setup([{ id: 1, slug: 'acme' }], []);
    await expect(svc.resolve('acme', { id: 2 })).rejects.toThrow(NotFoundException);
  });

  it('returns org when user is a member', async () => {
    const svc = setup(
      [{ id: 1, slug: 'acme' }],
      [{ userId: 2, organizationId: 1 }],
    );
    const org = await svc.resolve('acme', { id: 2 });
    expect(org.id).toBe(1);
  });

  // FIX 11.2: when enforceGroupMembership is ON, the org-resolution 404 for a
  // non-member must NOT fire — the resolved org is attached and the downstream
  // GroupMembershipGuard returns 403 instead. A genuinely missing org still 404s.
  describe('FIX 11.2: enforceGroupMembership ON', () => {
    const on = { enforceGroupMembership: true };

    it('resolves & attaches the org for a non-member (defers the 403 to the guard)', async () => {
      const svc = setup(
        [{ id: 1, slug: 'acme' }],
        [], // user is NOT a member
        { organizationIdentifierColumn: 'slug' },
        on,
      );
      const org = await svc.resolve('acme', { id: 2 });
      expect(org.id).toBe(1);
    });

    it('still 404s a genuinely non-existent org', async () => {
      const svc = setup([], [], { organizationIdentifierColumn: 'slug' }, on);
      await expect(svc.resolve('missing', { id: 2 })).rejects.toThrow(NotFoundException);
    });

    it('enforcement OFF (default) keeps the info-hiding 404 for a non-member', async () => {
      const svc = setup([{ id: 1, slug: 'acme' }], []);
      await expect(svc.resolve('acme', { id: 2 })).rejects.toThrow(NotFoundException);
    });
  });
});
