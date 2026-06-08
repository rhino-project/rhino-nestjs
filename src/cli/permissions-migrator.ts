/**
 * Lift per-user permissions into the shared org role layer.
 *
 * For each (organization, role) group, the literal intersection of every user's
 * `userRoles.permissions` becomes the `orgRolePermission` row (the shared role
 * layer). Each user's row is then reduced to only its delta
 * (`grantedPermissions = permissions − roleLayer`) and its legacy `permissions`
 * is cleared. Effective permissions are preserved exactly (the intersection is a
 * subset of every user's set, so nothing is gained or lost).
 *
 * Safe & idempotent:
 *   - Dry-run by default; pass { apply: true } to write.
 *   - Groups that already have an orgRolePermission row are skipped.
 *   - After a run the legacy permissions are empty, so a second run is a no-op.
 *   - Non-tenant (null organization) rows are left untouched.
 *
 * The `prisma` argument is any object exposing the `userRole` and
 * `orgRolePermission` delegates (a real PrismaClient, or a fake in tests).
 */
export interface MigratePermissionsResult {
  groupsMigrated: number;
  rowsReduced: number;
  skippedExisting: number;
  lines: string[];
}

function decode(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string') as string[];
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function readOrgId(r: any): number | string | null | undefined {
  return r.organizationId ?? r.organization_id;
}

function readRoleId(r: any): number | string | null | undefined {
  return r.roleId ?? r.role_id;
}

export async function migratePermissions(
  prisma: any,
  { apply = false }: { apply?: boolean } = {},
): Promise<MigratePermissionsResult> {
  const userRoles: any[] = await prisma.userRole.findMany();

  const relevant = userRoles.filter((r) => readOrgId(r) != null && readRoleId(r) != null);

  const groups = new Map<string, any[]>();
  for (const r of relevant) {
    const key = `${readOrgId(r)}::${readRoleId(r)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  let groupsMigrated = 0;
  let rowsReduced = 0;
  let skippedExisting = 0;
  const lines: string[] = [];

  for (const rows of groups.values()) {
    const withLegacy = rows.filter((r) => decode(r.permissions).length > 0);
    if (withLegacy.length === 0) continue;

    const orgId = readOrgId(rows[0]);
    const roleId = readRoleId(rows[0]);

    const existing = await prisma.orgRolePermission.findFirst({
      where: { organizationId: orgId, roleId: roleId },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }

    const sets = withLegacy.map((r) => decode(r.permissions));
    const roleLayer = sets.reduce((acc, set) => acc.filter((p) => set.includes(p)));

    lines.push(
      `org=${orgId} role=${roleId} → role layer [${roleLayer.join(', ')}] (${withLegacy.length} user rows)`,
    );

    if (apply) {
      await prisma.orgRolePermission.create({
        data: { organizationId: orgId, roleId: roleId, permissions: roleLayer },
      });

      for (const r of withLegacy) {
        const legacy = decode(r.permissions);
        const grants = decode(r.grantedPermissions ?? r.granted_permissions);
        const delta = Array.from(new Set([...legacy.filter((p) => !roleLayer.includes(p)), ...grants]));

        await prisma.userRole.update({
          where: { id: r.id },
          data: { permissions: [], grantedPermissions: delta },
        });
      }
    }

    groupsMigrated++;
    rowsReduced += withLegacy.length;
  }

  return { groupsMigrated, rowsReduced, skippedExisting, lines };
}
