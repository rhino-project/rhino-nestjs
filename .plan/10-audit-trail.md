# 10 Audit Trail

**What it does:** Automatic change logging on create, update, delete, restore, and force-delete events. Logs who changed what, when, old values, and new values.

**Laravel equivalent:** `Traits/HasAuditTrail.php`, `Models/AuditLog.php`.

**NestJS implementation:**

Use Prisma Client Extensions to intercept create/update/delete and log to an `audit_logs` table:

```typescript
export function withAuditTrail(prisma: PrismaClient, config: AuditConfig) {
  return prisma.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (isAuditModel(model)) {
            await logAudit(prisma, model, 'created', null, result, config);
          }
          return result;
        },
        async update({ model, args, query }) {
          if (isAuditModel(model)) {
            const oldRecord = await prisma[model].findUnique({ where: args.where });
            const result = await query(args);
            const changes = diffObjects(oldRecord, result, config.excludeFields);
            if (Object.keys(changes.new).length > 0) {
              await logAudit(prisma, model, 'updated', changes.old, changes.new, config);
            }
            return result;
          }
          return query(args);
        },
      },
    },
  });
}
```

**AuditLog Prisma model:**

```prisma
model AuditLog {
  id             Int      @id @default(autoincrement())
  auditableType  String
  auditableId    Int
  action         String   // created, updated, deleted, force_deleted, restored
  oldValues      Json?
  newValues      Json?
  userId         Int?
  organizationId Int?
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime @default(now())
}
```

**Excluded fields** default: `['password', 'rememberToken']`. Configurable per model.

**Files to create:**
- `/src/prisma/prisma-audit.extension.ts`
- `/src/services/audit.service.ts`

**Tests:** Create logs new values, update logs old/new diff, delete logs all values, excluded fields not logged, organizationId included when present.

**Dependencies:** 02, 03.

---
