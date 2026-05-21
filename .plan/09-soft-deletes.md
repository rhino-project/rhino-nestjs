# 09 Soft Deletes

**What it does:** Adds trash, restore, and force-delete endpoints for models that opt in. Uses Prisma's soft delete pattern (`deletedAt` field).

**Laravel equivalent:** `GlobalController.php` lines 346-482, Laravel's `SoftDeletes` trait.

**NestJS implementation:**

Prisma does not have built-in soft deletes. Use Prisma Client Extensions:

```typescript
// prisma-soft-delete.extension.ts
export function withSoftDelete(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (isSoftDeleteModel(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (isSoftDeleteModel(model)) {
            return prisma[model].update({
              where: args.where,
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
      },
    },
  });
}
```

**Additional endpoints** registered when `softDeletes: true`:

| Method | Route | Action |
|--------|-------|--------|
| GET | `/:slug/trashed` | List trashed records |
| POST | `/:slug/:id/restore` | Restore a record |
| DELETE | `/:slug/:id/force-delete` | Permanently delete |

Each action checks its own permission: `viewTrashed`, `restore`, `forceDelete`.

**Files to create:**
- `/src/prisma/prisma-soft-delete.extension.ts`
- Additional methods in `global.controller.ts`

**Tests:** Soft delete returns 204, record appears in trashed, restore brings it back, force-delete permanently removes, separate permissions for each action.

**Dependencies:** 03, 05.

---
