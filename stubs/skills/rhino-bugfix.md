---
name: rhino-bugfix
description: Fix a bug in an Rhino NestJS application using TDD — reproduce with a failing test, fix the root cause, verify.
---

You are fixing a bug in an Rhino NestJS application. Always reproduce the bug with a failing test before touching production code.

## Step 1: Reproduce the Bug

Before writing a fix, write a test that demonstrates the bug. The test MUST fail with the current code.

Describe the bug as a test assertion:

```typescript
it('should [expected behavior] but [actual behavior]', async () => {
  // Arrange: set up the exact conditions that trigger the bug
  // Act: perform the action that causes the bug
  // Assert: what SHOULD happen (not what currently happens)
});
```

Run the test to confirm it fails:
```bash
npm test -- --testPathPattern=your-spec
```

If the test passes immediately, either the bug is already fixed or you have not reproduced the correct scenario. Do not proceed until the test fails.

## Step 2: Diagnose the Root Cause

Identify which layer the bug lives in:

| Layer | File | Common bugs |
|-------|------|-------------|
| Model registration | `app.module.ts` | Wrong Prisma model name, missing filter/include |
| Query builder | `query-builder.service.ts` | Filter/sort/include not applied correctly |
| Resource service | `resource.service.ts` | Missing org scope, wrong castId, null not handled |
| Validation | `validation.service.ts` | Wrong schema picked, forbidden fields logic wrong |
| Policy | `policies/[model].policy.ts` | Wrong permission, missing role branch |
| Policy guard | `guards/resource-policy.guard.ts` | Wrong action resolved from HTTP method/path |
| Serializer | `services/serializer.service.ts` | Hidden column not stripped, wrong field returned |
| Controller | `controllers/global.controller.ts` | Wrong status code, missing audit log call |

Read the relevant file(s) to understand the logic flow.

## Step 3: Common Bug Patterns

### Bug: 404 on a valid record (wrong org scope)

The model has `belongsToOrganization: true` but the record was created without `organizationId`, or the request uses the wrong org identifier.

Check:
- `orgFilter()` in `resource.service.ts` — is `organizationId` being set on create?
- `ResolveOrganizationMiddleware` — is the org resolved from the correct URL param?
- `multiTenant.organizationIdentifierColumn` — does it match the actual column in the DB?

### Bug: 403 that should be 200 (permission check wrong)

```bash
# Debug: check what permission is being checked
# Add temporary log in resource-policy.guard.ts:
console.log('Checking permission:', `${modelSlug}.${action}`, 'user:', user?.permissions);
```

Verify:
- The user actually has the correct permission in `user_roles.permissions`.
- `resolveUserRoleSlug()` returns the correct role for the user+org combination.
- The `resourceSlug` on the policy matches the key in `RhinoModule.forRoot()`.

### Bug: `organizationId` appears in the response body

The serializer is not stripping `organizationId`. This leaks tenant information.

Check `serializer.service.ts` — is `organizationId` in `additionalHiddenColumns` or in the policy's `hiddenAttributesForShow()`?

### Bug: Validation passes fields that should be forbidden

Check `validation.service.ts` `resolvePermittedFields()` — is the policy's `permittedAttributesForCreate()` being called? Is `allowAllFields` (`permittedFields = ['*']`) being returned when it should not be?

### Bug: Soft-deleted records appear in normal listing

`resource.service.ts` `findAll()` should filter `where.deletedAt = null` unless `onlyTrashed` or `includeTrashed` is set. Check that `softDeletes: true` is set on the model registration.

### Bug: Prisma error "model not found"

`PrismaService.model(name)` tries: exact name → camelCase → lowercase. If your Prisma model is `BlogPost`, pass `model: 'blogPost'` (camelCase) in the registration.

## Step 4: Apply the Fix

Make the minimal change that fixes the bug. Do not refactor unrelated code in the same change.

Run the test that was failing:
```bash
npm test -- --testPathPattern=your-spec
```

It should now pass.

## Step 5: Run the Full Suite

```bash
npm test
```

All previously passing tests must still pass. If a new test failure appears, it means the fix has a side effect — investigate before proceeding.

## Step 6: Add Regression Context

Add a comment above the test that explains why the test exists:

```typescript
// Regression: bug where belongsToOrganization was not applied on findAll,
// allowing cross-tenant data leakage. Fixed in resource.service.ts:orgFilter().
it('scopes posts to the current organization', async () => { /* ... */ });
```

This ensures future contributors understand why the test must not be deleted.
