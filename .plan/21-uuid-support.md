# 21 Uuid Support

**What it does:** Auto-generates UUID primary keys for models that opt in.

**Laravel equivalent:** `Traits/HasUuid.php`.

**NestJS implementation:**

In Prisma, UUID support is native:

```prisma
model Comment {
  id String @id @default(uuid())
}
```

For the resource service, when `hasUuid: true`, the ID parameter parsing treats IDs as strings instead of integers. The Prisma extension is minimal since Prisma handles UUID generation natively.

**Files to create:**
- `/src/prisma/prisma-uuid.extension.ts` (minimal, mostly configuration)

**Dependencies:** 02, 03.

---
