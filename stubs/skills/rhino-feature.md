---
name: rhino-feature
description: Add a new feature to an Rhino NestJS application using TDD. Reads context, writes tests first, then implements.
---

You are adding a new feature to an Rhino NestJS application. Follow the TDD flow: understand → plan → test → implement → verify.

## Step 1: Understand the Codebase

Read the following files to understand the project structure before writing any code:

1. `CLAUDE.md` — development rules, architecture overview, feature table.
2. `src/app.module.ts` — which models are registered and how.
3. `prisma/schema.prisma` — the data model.
4. Any existing `*.spec.ts` files related to the feature area.

Ask the user to clarify the feature if anything is ambiguous:
- Which model(s) does this feature affect?
- Which roles should have access?
- What are the expected HTTP status codes for happy path and error cases?
- Does it require a Prisma schema change?

## Step 2: Plan Before Coding

Write a brief plan in plain text (no code yet):

- What Prisma schema changes are needed?
- What `ModelRegistration` changes are needed (new `allowedFilters`, `allowedIncludes`, Zod schema, etc.)?
- What policy changes are needed (`permittedAttributesForCreate`, etc.)?
- What new service methods (if any) are needed?
- What tests will you write and what will they verify?

Show the plan to the user and wait for approval before proceeding.

## Step 3: Write Tests First

Create or update `*.spec.ts` files BEFORE touching implementation. Failing tests prove the feature is missing.

Write tests for each scenario:

```typescript
// Happy path — 200 / 201
it('allows admin to create a [resource]', async () => {
  // Arrange: create org, user with admin role
  // Act: POST /api/:org/resource with valid body
  // Assert: 201, response matches expected shape
});

// Authorization denied — 403
it('blocks viewer from creating a [resource]', async () => {
  // Arrange: user with viewer role (no store permission)
  // Act: same POST request
  // Assert: 403
});

// Validation failure — 422
it('returns 422 when required field is missing', async () => {
  // Act: POST with empty body
  // Assert: 422, errors object contains field key
});

// Not found — 404
it('returns 404 for unknown resource id', async () => { /* ... */ });

// Multi-tenant isolation
it('does not return [resource] data from another organization', async () => {
  // Create data in org A, request from org B, verify 404 or empty list
});
```

Run tests to confirm they fail:
```bash
npm test -- --testPathPattern=your-spec-file
```

## Step 4: Implement

Work in this order:

1. **Prisma schema** — add/modify models in `prisma/schema.prisma`, then:
   ```bash
   npx prisma migrate dev --name add_[feature_name]
   npx prisma generate
   ```

2. **Zod schema** — create or update validation:
   ```typescript
   // Base schema (used for both store and update)
   export const PostSchema = z.object({
     title: z.string().max(255),
     status: z.enum(['draft', 'published']),
   });

   // Action-specific override (update makes all fields optional)
   export const PostUpdateSchema = PostSchema.partial();
   ```

3. **Policy** — create or update a `ResourcePolicy` subclass:
   ```typescript
   export class PostPolicy extends ResourcePolicy {
     permittedAttributesForCreate(user: any): string[] {
       if (this.hasRole(user, 'admin', /* org */)) return ['*'];
       return ['title', 'content'];
     }
     permittedAttributesForUpdate(user: any): string[] {
       return this.permittedAttributesForCreate(user);
     }
   }
   ```

4. **Model registration** — update `RhinoModule.forRoot()`:
   ```typescript
   posts: {
     model: 'post',
     policy: PostPolicy,
     validation: PostSchema,
     validationUpdate: PostUpdateSchema,
     allowedFilters: ['status'],
     allowedSorts: ['createdAt', 'title'],
     softDeletes: true,
     belongsToOrganization: true,
   }
   ```

5. **Service methods** — add to an existing service if the logic is beyond standard CRUD. Only create a new controller if the feature cannot be expressed through model registration.

## Step 5: Verify

```bash
npm test -- --testPathPattern=your-spec-file  # New tests must pass
npm test                                        # Full suite must stay green
```

Fix any regressions before declaring the feature done.

## Step 6: Update Docs

Update `docs/docs/server/nestjs/` — find the relevant page and update it with code examples. If this is a genuinely new concept, create a new doc page. Update `CLAUDE.md` if the features table changed.

## Common Mistakes to Avoid

- Do not include `organizationId` in the Zod schema — `ValidationService` strips it automatically.
- Do not use `class-validator` decorators — use Zod schemas.
- Do not create per-model controllers — all CRUD flows through `GlobalController`.
- Do not read Prisma directly from controllers — use `ResourceService`.
- Always test multi-tenant isolation, even if it seems obvious.
