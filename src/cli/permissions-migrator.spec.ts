import { migratePermissions } from './permissions-migrator';

/**
 * Minimal in-memory Prisma fake exposing the `userRole` + `orgRolePermission`
 * delegates the migrator uses (findMany / findFirst / create / update).
 */
function fakePrisma(userRoles: any[]) {
  const orgRolePermissions: any[] = [];
  let nextOrpId = 1;
  return {
    _userRoles: userRoles,
    _orgRolePermissions: orgRolePermissions,
    userRole: {
      findMany: async () => userRoles.map((r) => ({ ...r })),
      update: async ({ where, data }: any) => {
        const row = userRoles.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    orgRolePermission: {
      findFirst: async ({ where }: any) =>
        orgRolePermissions.find(
          (o) => o.organizationId === where.organizationId && o.roleId === where.roleId,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextOrpId++, ...data };
        orgRolePermissions.push(row);
        return row;
      },
    },
  };
}

describe('migratePermissions', () => {
  it('is a dry-run by default (no writes)', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: 1, roleId: 1, permissions: ['*'] }]);
    const result = await migratePermissions(prisma);

    expect(prisma._orgRolePermissions).toHaveLength(0);
    expect(prisma._userRoles[0].permissions).toEqual(['*']);
    expect(result.groupsMigrated).toBe(1);
  });

  it('lifts the intersection into the role layer and reduces rows to deltas', async () => {
    const prisma = fakePrisma([
      { id: 1, organizationId: 1, roleId: 1, permissions: ['posts.*'] },
      { id: 2, organizationId: 1, roleId: 1, permissions: ['posts.*', 'comments.index'] },
    ]);

    await migratePermissions(prisma, { apply: true });

    expect(prisma._orgRolePermissions).toHaveLength(1);
    expect(prisma._orgRolePermissions[0]).toMatchObject({
      organizationId: 1,
      roleId: 1,
      permissions: ['posts.*'],
    });

    expect(prisma._userRoles[0].permissions).toEqual([]);
    expect(prisma._userRoles[0].grantedPermissions).toEqual([]);
    expect(prisma._userRoles[1].permissions).toEqual([]);
    expect(prisma._userRoles[1].grantedPermissions).toEqual(['comments.index']);
  });

  it('is idempotent', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: 1, roleId: 1, permissions: ['*'] }]);

    await migratePermissions(prisma, { apply: true });
    const second = await migratePermissions(prisma, { apply: true });

    expect(prisma._orgRolePermissions).toHaveLength(1);
    expect(second.groupsMigrated).toBe(0);
  });

  it('skips a group that already has a role layer', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: 1, roleId: 1, permissions: ['posts.*'] }]);
    prisma._orgRolePermissions.push({ id: 99, organizationId: 1, roleId: 1, permissions: ['comments.*'] });

    const result = await migratePermissions(prisma, { apply: true });

    expect(result.skippedExisting).toBe(1);
    expect(prisma._userRoles[0].permissions).toEqual(['posts.*']);
  });

  it('leaves non-tenant (null organization) rows untouched', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: null, roleId: 1, permissions: ['posts.*'] }]);

    const result = await migratePermissions(prisma, { apply: true });

    expect(result.groupsMigrated).toBe(0);
    expect(prisma._orgRolePermissions).toHaveLength(0);
    expect(prisma._userRoles[0].permissions).toEqual(['posts.*']);
  });

  it('coerces JSON-string permission columns (BP-008)', async () => {
    const prisma = fakePrisma([
      { id: 1, organizationId: 1, roleId: 1, permissions: '["posts.*"]' },
      { id: 2, organizationId: 1, roleId: 1, permissions: '["posts.*","comments.index"]' },
    ]);

    await migratePermissions(prisma, { apply: true });

    expect(prisma._orgRolePermissions[0].permissions).toEqual(['posts.*']);
    expect(prisma._userRoles[1].grantedPermissions).toEqual(['comments.index']);
  });
});
