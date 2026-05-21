---
name: rhino-migrate
description: Create or update a Prisma migration in an Rhino NestJS project — schema change, registration update, validation update, and test run.
---

You are making a Prisma schema change in an Rhino NestJS application. Follow these steps to keep the schema, registration, validation, and tests in sync.

## Step 1: Read Current State

```bash
cat prisma/schema.prisma
npm test  # baseline — note pass/fail counts
```

Also read:
- `src/app.module.ts` — model registrations affected by the schema change
- The Zod schema file(s) for affected models
- The policy file(s) for affected models

## Step 2: Make the Schema Change

Edit `prisma/schema.prisma`. Follow these conventions:
- Field names: camelCase (`organizationId`, `createdAt`)
- Model names: PascalCase singular (`BlogPost`)
- Required fields do NOT have `?`; optional fields have `?`
- Add `@default(now())` to `createdAt`, `@updatedAt` to `updatedAt`
- Add `deletedAt DateTime?` for soft-delete models

Common changes:

**Add a new field:**
```prisma
model Post {
  // existing fields...
  featuredImageUrl String?   // new optional field
  publishedAt      DateTime? // new optional timestamp
}
```

**Add a new model:**
```prisma
model Tag {
  id        Int     @id @default(autoincrement())
  name      String
  slug      String  @unique
  posts     Post[]  @relation("PostTags")
  createdAt DateTime @default(now())
}
```

**Add a many-to-many relation:**
```prisma
model Post {
  // ...
  tags Tag[] @relation("PostTags")
}
```

**Add an index:**
```prisma
model Post {
  organizationId Int
  @@index([organizationId])
}
```

## Step 3: Run Migration

```bash
# Development (creates a new migration file)
npx prisma migrate dev --name [descriptive_name]

# Examples:
npx prisma migrate dev --name add_published_at_to_posts
npx prisma migrate dev --name create_tags_table
npx prisma migrate dev --name add_featured_image_url_to_posts
```

Then regenerate the Prisma client:
```bash
npx prisma generate
```

## Step 4: Update Model Registration

In `app.module.ts`, update the affected model's `ModelRegistration`:

**New filterable/sortable fields:**
```typescript
posts: {
  allowedFilters: ['status', 'userId', 'publishedAt'],  // add publishedAt
  allowedSorts: ['createdAt', 'title', 'publishedAt'],  // add publishedAt
}
```

**New includeable relationship:**
```typescript
posts: {
  allowedIncludes: ['user', 'comments', 'tags'],  // add tags
}
```

**New searchable field:**
```typescript
posts: {
  allowedSearch: ['title', 'content', 'excerpt'],  // add excerpt
}
```

## Step 5: Update Zod Validation Schema

Add new fields to the validation schema(s). Match the Prisma types:

| Prisma type | Zod equivalent |
|---|---|
| `String` | `z.string()` |
| `String?` | `z.string().optional()` |
| `Int` | `z.number().int()` |
| `Int?` | `z.number().int().optional()` |
| `Boolean` | `z.boolean()` |
| `DateTime` | `z.string().datetime()` or `z.date()` |
| `Json` | `z.any()` or a specific schema |
| `Float` / `Decimal` | `z.number()` |

```typescript
export const PostSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  publishedAt: z.string().datetime().optional(),  // new field
});
```

## Step 6: Update Policy (if needed)

If the new field should be write-restricted by role, update `permittedAttributesForCreate` and `permittedAttributesForUpdate`:

```typescript
permittedAttributesForCreate(user: any): string[] {
  if (this.hasRole(user, 'admin')) return ['*'];
  // Editors can set publishedAt only if they have the publish role
  if (this.hasRole(user, 'publisher')) {
    return ['title', 'content', 'publishedAt'];
  }
  return ['title', 'content'];
}
```

## Step 7: Run Tests

```bash
npm test
```

Fix any failures. Common failure causes after a migration:
- Prisma client not regenerated (`npx prisma generate` again)
- Test database needs migration (`npx prisma migrate dev` in the test env)
- New required field not included in test seed data
- TypeScript type errors after schema change (`npx tsc --noEmit`)

## Step 8: Production Deployment Note

For production deployments, use `prisma migrate deploy` (not `migrate dev`):

```bash
# In CI/CD pipeline — runs pending migrations without prompts
npx prisma migrate deploy
```

Never run `migrate dev` in production. Document this in your deployment runbook.

## Checklist

- [ ] `prisma/schema.prisma` updated
- [ ] `npx prisma migrate dev --name [...]` run successfully
- [ ] `npx prisma generate` run to regenerate client
- [ ] `ModelRegistration` updated (filters, sorts, includes, search)
- [ ] Zod schema(s) updated with new fields
- [ ] Policy updated if field-level permissions needed
- [ ] All tests pass (`npm test`)
- [ ] `npx tsc --noEmit` produces no errors
