---
name: rhino-refactor
description: Safely refactor Rhino NestJS code — establish baseline, apply incremental changes, verify tests pass at each step.
---

You are refactoring code in an Rhino NestJS project. The goal is to improve structure without changing observable behavior.

## Step 1: Establish Baseline

Before touching any code:

```bash
npm test
```

Note the exact test count and which tests pass. This is your baseline. Every test that currently passes must still pass after the refactor.

Read the code to be refactored and identify:
- What is the current structure?
- What specific problem does the refactor solve? (readability, performance, duplication, etc.)
- What is the target structure?

## Step 2: Identify the Scope

Clarify with the user what is in scope:
- Which files are affected?
- Are public interfaces (API config shape, service method signatures) changing?
- Does this touch any of these critical paths?
  - `resource.service.ts` — any change here affects all CRUD operations
  - `resource-policy.guard.ts` — any change here affects authorization
  - `validation.service.ts` — any change here affects input validation
  - `query-builder.service.ts` — any change here affects all queries

If public interfaces are changing, plan a migration path before starting.

## Step 3: Refactor Incrementally

Work in small steps. After each step, run the tests:

```bash
npm test
```

Common refactor patterns in Rhino NestJS:

### Extract a service method

If controller code is doing logic that belongs in a service:

```typescript
// Before: logic in controller
@Post(':modelSlug')
async store(...) {
  const orgFilter = ...;  // logic here
  const record = await ...;
}

// After: logic in ResourceService
async create(modelSlug: string, data: any, ctx: ResourceContext) {
  // moved logic
}
```

### Consolidate repeated Zod schemas

```typescript
// Before: duplicated schema fragments
const StoreSchema = z.object({ title: z.string(), status: z.enum([...]) });
const UpdateSchema = z.object({ title: z.string().optional(), status: z.enum([...]).optional() });

// After: derived from base
const BaseSchema = z.object({ title: z.string(), status: z.enum(['draft', 'published']) });
const StoreSchema = BaseSchema;
const UpdateSchema = BaseSchema.partial();
```

### Extract repeated policy logic

```typescript
// Before: repeated hasRole checks
permittedAttributesForCreate(user: any) {
  if (this.hasRole(user, 'admin') || this.hasRole(user, 'owner')) return ['*'];
  // ...
}
permittedAttributesForUpdate(user: any) {
  if (this.hasRole(user, 'admin') || this.hasRole(user, 'owner')) return ['*'];
  // ...
}

// After: extracted helper
private isPrivileged(user: any) {
  return this.hasRole(user, 'admin') || this.hasRole(user, 'owner');
}
```

### Consolidate model registration config

```typescript
// Before: scattered constants
const POST_FILTERS = ['status', 'userId'];
const POST_SORTS = ['createdAt', 'title'];

// After: co-located config object
export const PostModelConfig: ModelRegistration = {
  model: 'post',
  allowedFilters: ['status', 'userId'],
  allowedSorts: ['createdAt', 'title'],
  // ...
};
```

## Step 4: Update Types

If method signatures changed, update:
- All call sites
- TypeScript interfaces in `src/interfaces/`
- Type exports in `src/index.ts`

Run:
```bash
npx tsc --noEmit
```

Fix all type errors before running tests.

## Step 5: Verify

```bash
npm test         # Full suite — must match baseline exactly
npx tsc --noEmit # No type errors
```

If any test fails that was passing before, fix the code (not the test). Only modify tests if the test was genuinely wrong.

## Step 6: Document Changes

If the refactor changed any public API:
- Update `CLAUDE.md`
- Update `README.md` if the config shape changed
- Update the relevant Docusaurus doc page

## Rules

- Never comment out a passing test to make a refactor work.
- Never change behavior while refactoring — separate refactor commits from behavior changes.
- If you discover a bug during refactoring, note it but do not fix it in the same change. Fix it separately with a test first.
- Keep commits small. One logical change per commit.
