---
name: rhino-model
description: Create a new Rhino model definition — Prisma schema, registration, Zod validation, and policy skeleton.
---

You are creating a new model in an Rhino NestJS application. Follow these steps in order.

## Step 1: Read Context

Before creating anything, read:
- `prisma/schema.prisma` — existing models and conventions.
- `src/app.module.ts` — how models are currently registered.
- `CLAUDE.md` — project conventions.

Ask the user for:
- Model name (PascalCase singular, e.g., `BlogPost`)
- Fields and their types
- Relationships to existing models
- Whether it needs multi-tenancy (`belongsToOrganization`)
- Whether it needs soft deletes, audit trail, or UUID primary key
- Which roles should have access and what they can do

## Step 2: Prisma Schema

Add the model to `prisma/schema.prisma`. Follow existing casing conventions (camelCase fields):

```prisma
model BlogPost {
  id             Int           @id @default(autoincrement())
  title          String
  content        String?
  status         String        @default("draft")
  organizationId Int?
  userId         Int
  deletedAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  organization   Organization? @relation(fields: [organizationId], references: [id])
  user           User          @relation(fields: [userId], references: [id])
}
```

Run migration:
```bash
npx prisma migrate dev --name create_blog_posts
npx prisma generate
```

## Step 3: Zod Validation Schema

Create `src/schemas/blog-post.schema.ts`:

```typescript
import { z } from 'zod';

export const BlogPostSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  userId: z.number().int().positive(),
});

// Update allows all fields optional (partial)
export const BlogPostUpdateSchema = BlogPostSchema.partial();

// Role-keyed schemas (optional — use when roles need different required fields)
export const BlogPostStoreByRole = {
  admin: BlogPostSchema,
  '*': BlogPostSchema.omit({ status: true }),
};
```

## Step 4: Policy

Create `src/policies/blog-post.policy.ts`:

```typescript
import { ResourcePolicy } from '@rhino-dev/rhino-nestjs';

export class BlogPostPolicy extends ResourcePolicy {
  // Control which fields each role can write
  permittedAttributesForCreate(user: any): string[] {
    if (this.hasRole(user, 'admin')) return ['*'];
    if (this.hasRole(user, 'editor')) return ['title', 'content'];
    return [];
  }

  permittedAttributesForUpdate(user: any): string[] {
    return this.permittedAttributesForCreate(user);
  }

  // Control which fields each role can read in responses
  permittedAttributesForShow(user: any): string[] {
    return ['*'];
  }

  hiddenAttributesForShow(user: any): string[] {
    if (this.hasRole(user, 'admin')) return [];
    return ['internalNotes'];
  }
}
```

## Step 5: Register in AppModule

Add to `RhinoModule.forRoot({ models: { ... } })`:

```typescript
'blog-posts': {
  model: 'blogPost',               // matches Prisma client key
  policy: BlogPostPolicy,
  validation: BlogPostSchema,
  validationUpdate: BlogPostUpdateSchema,

  // Query capabilities
  allowedFilters: ['status', 'userId'],
  allowedSorts: ['createdAt', 'title', 'updatedAt'],
  defaultSort: '-createdAt',
  allowedIncludes: ['user'],
  allowedSearch: ['title', 'content'],

  // Features
  softDeletes: true,
  belongsToOrganization: true,
  hasAuditTrail: true,
  paginationEnabled: true,
  perPage: 25,
}
```

## Step 6: Write Tests

Create `src/services/blog-post.spec.ts` (or `test/e2e/blog-post.e2e-spec.ts`):

```typescript
describe('BlogPost endpoints', () => {
  it('returns 201 when admin creates a blog post', async () => { /* ... */ });
  it('returns 403 when viewer tries to create a blog post', async () => { /* ... */ });
  it('returns 422 when title is missing', async () => { /* ... */ });
  it('scopes blog posts to the current organization', async () => { /* ... */ });
  it('soft deletes the blog post on DELETE', async () => { /* ... */ });
});
```

Run:
```bash
npm test
```

## Step 7: Verify Route Table

Check that the model is generating the expected routes:

```typescript
import { describeRoutes } from '@rhino-dev/rhino-nestjs';
// In a test or startup log:
console.log(describeRoutes(configService));
```

Expected routes for `blog-posts`:
```
GET    /api/:org/blog-posts
POST   /api/:org/blog-posts
GET    /api/:org/blog-posts/:id
PUT    /api/:org/blog-posts/:id
DELETE /api/:org/blog-posts/:id
GET    /api/:org/blog-posts/trashed
POST   /api/:org/blog-posts/:id/restore
DELETE /api/:org/blog-posts/:id/force-delete
```

## Checklist

- [ ] Prisma schema added and migrated
- [ ] Zod schema created (store + update variants)
- [ ] Policy created with `permittedAttributesForCreate/Update/Show`
- [ ] Model registered in `RhinoModule.forRoot()`
- [ ] Tests written and passing
- [ ] `CLAUDE.md` features table updated if this adds a new capability
