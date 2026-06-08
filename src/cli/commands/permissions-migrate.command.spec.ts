import { runPermissionsMigrate } from './permissions-migrate.command';

function fakePrisma(userRoles: any[]) {
  const orgRolePermissions: any[] = [];
  let id = 1;
  let disconnected = false;
  return {
    _orgRolePermissions: orgRolePermissions,
    _disconnected: () => disconnected,
    userRole: {
      findMany: async () => userRoles.map((r) => ({ ...r })),
      update: async ({ where, data }: any) => Object.assign(userRoles.find((r) => r.id === where.id), data),
    },
    orgRolePermission: {
      findFirst: async ({ where }: any) =>
        orgRolePermissions.find((o) => o.organizationId === where.organizationId && o.roleId === where.roleId) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id++, ...data };
        orgRolePermissions.push(row);
        return row;
      },
    },
    $disconnect: async () => {
      disconnected = true;
    },
  };
}

describe('runPermissionsMigrate', () => {
  it('dry-run reports without writing and prompts for --apply', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: 1, roleId: 1, permissions: ['*'] }]);
    const logs: string[] = [];
    await runPermissionsMigrate({}, { loadPrisma: () => prisma, log: (m) => logs.push(m) });

    expect(prisma._orgRolePermissions).toHaveLength(0);
    expect(logs.join('\n')).toContain('Would migrate 1');
    expect(logs.join('\n')).toContain('--apply');
    expect(prisma._disconnected()).toBe(true);
  });

  it('--apply writes the role layer', async () => {
    const prisma = fakePrisma([{ id: 1, organizationId: 1, roleId: 1, permissions: ['*'] }]);
    const logs: string[] = [];
    await runPermissionsMigrate({ apply: true }, { loadPrisma: () => prisma, log: (m) => logs.push(m) });

    expect(prisma._orgRolePermissions).toHaveLength(1);
    expect(logs.join('\n')).toContain('Migrated 1');
  });

  it('reports gracefully when Prisma cannot be loaded', async () => {
    const logs: string[] = [];
    await runPermissionsMigrate(
      {},
      {
        loadPrisma: () => {
          throw new Error('no prisma');
        },
        log: (m) => logs.push(m),
      },
    );
    expect(logs.join('\n')).toContain('Could not load @prisma/client');
  });
});
