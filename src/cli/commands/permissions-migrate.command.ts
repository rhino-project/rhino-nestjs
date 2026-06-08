import { migratePermissions } from '../permissions-migrator';

/**
 * `npx rhino permissions-migrate [--apply]`
 *
 * Lifts per-user `userRoles.permissions` into the shared `orgRolePermission`
 * role layer, reducing each user row to its delta. Dry-run unless `--apply`.
 *
 * Loads the consumer app's PrismaClient at runtime (the lib has no DB of its
 * own). A custom client can be injected for testing.
 */
export async function runPermissionsMigrate(
  flags: Record<string, string | true>,
  deps: { loadPrisma?: () => any; log?: (msg: string) => void } = {},
): Promise<void> {
  const apply = flags.apply === true || flags.apply === 'true';
  const log = deps.log ?? ((m: string) => console.log(m));

  let prisma: any;
  try {
    const load =
      deps.loadPrisma ??
      (() => {
        // Resolved from the consumer app's installed @prisma/client.
        const { PrismaClient } = require('@prisma/client');
        return new PrismaClient();
      });
    prisma = load();
  } catch {
    log('Could not load @prisma/client. Run this from your application root where Prisma is installed.');
    return;
  }

  try {
    const result = await migratePermissions(prisma, { apply });
    for (const line of result.lines) log(line);

    const verb = apply ? 'Migrated' : 'Would migrate';
    let summary = `${verb} ${result.groupsMigrated} (org, role) group(s); ${result.rowsReduced} user row(s) reduced to deltas.`;
    if (result.skippedExisting > 0) {
      summary += ` Skipped ${result.skippedExisting} group(s) with an existing role layer.`;
    }
    log(summary);

    if (!apply && result.groupsMigrated > 0) {
      log('Dry-run only. Re-run with --apply to write these changes.');
    }
  } finally {
    if (typeof prisma.$disconnect === 'function') {
      await prisma.$disconnect().catch(() => undefined);
    }
  }
}
