---
name: rhino-review
description: Review Rhino NestJS code for correctness, security, and alignment with conventions. Produces a structured findings report.
---

You are reviewing code in an Rhino NestJS project. Produce a structured report with findings grouped by severity.

## Step 1: Gather Context

Read the following before reviewing:
- `CLAUDE.md` — development rules and conventions
- `src/app.module.ts` — model registrations
- `prisma/schema.prisma` — data model
- The specific file(s) the user asked you to review

## Step 2: Run the Tests First

```bash
npm test
```

Note any failing tests. Do not proceed with fixes until you have the test baseline.

## Step 3: Review Checklist

Work through each category and note findings. Severity: **Critical** (security / data loss), **Major** (bug / missing behavior), **Minor** (convention / style).

### Security

- [ ] No `organizationId` accepted from request body — `ValidationService` must strip it.
- [ ] Permissions checked before data access — `ResourcePolicyGuard` applied.
- [ ] Cross-tenant isolation — `belongsToOrganization: true` set on models that need it.
- [ ] No raw SQL queries that could be injected.
- [ ] JWT secret comes from env (`process.env.JWT_SECRET`), not hardcoded.
- [ ] Sensitive fields (`password`, `rememberToken`) in `auditExclude` and in `additionalHiddenColumns`.

### Model Registration

- [ ] Every field that should be filterable is in `allowedFilters`.
- [ ] Every field that should be sortable is in `allowedSorts`.
- [ ] `defaultSort` is set (avoid undefined ordering).
- [ ] `allowedIncludes` lists only relationships that exist on the Prisma model.
- [ ] `allowedSearch` fields are string columns (not IDs or JSON).
- [ ] `softDeletes: true` is set if the Prisma model has a `deletedAt` field.
- [ ] `hasAuditTrail: true` if audit logging is required.
- [ ] `paginationEnabled` explicitly set if the model returns large datasets.

### Policy

- [ ] `permittedAttributesForCreate` and `permittedAttributesForUpdate` implemented.
- [ ] `permittedAttributesForShow` and `hiddenAttributesForShow` implemented.
- [ ] Every role in the permission matrix is covered (no missing `else` branches).
- [ ] `hasRole(user, role)` is used correctly — it checks role within org context.
- [ ] Overridden action methods (`update`, `delete`, etc.) call `super.method()`.
- [ ] `resourceSlug` is set correctly (must match the model key in `RhinoModule.forRoot`).

### Zod Validation

- [ ] `validationStore` schema marks required fields as required.
- [ ] `validationUpdate` schema makes all fields optional (`.partial()` or equivalent).
- [ ] Enum values in the Zod schema match the valid values in Prisma schema / docs.
- [ ] FK fields validated as positive integers (not strings).
- [ ] No `organizationId` / `organization_id` in the Zod schema.
- [ ] Role-keyed schemas (`Record<string, ZodSchema>`) have a `'*'` fallback.

### Tests

- [ ] Happy path (200/201) tests exist for each CRUD action.
- [ ] 403 tests for each role that should be denied.
- [ ] 422 test for missing required field on store.
- [ ] 404 test for non-existent ID.
- [ ] Multi-tenant isolation test (org A data not visible to org B).
- [ ] Soft delete tests (trashed, restore, force-delete) if `softDeletes: true`.
- [ ] Audit log created for creates, updates, and deletes if `hasAuditTrail: true`.

### Code Style

- [ ] No `class-validator` decorators — Zod only.
- [ ] No per-model controllers — all CRUD through `GlobalController`.
- [ ] Business logic in services, not controllers.
- [ ] No direct `prisma.client.[model]` calls in controllers — use `ResourceService`.
- [ ] `@Injectable()` decorator on all services.
- [ ] All method parameters and return types explicitly typed.

## Step 4: Produce Report

Format your findings as:

```
## Code Review Report — [filename or feature]

### Critical
1. [Finding]: [file:line] — [explanation and fix]

### Major
1. [Finding]: [file:line] — [explanation and fix]

### Minor
1. [Finding]: [file:line] — [explanation and fix]

### Passed Checks
- Security: organizationId stripped ✓
- Tests: multi-tenant isolation ✓
- ...
```

## Step 5: Apply Fixes (if requested)

If the user asks you to fix the findings:
1. Fix Critical issues first.
2. Write regression tests for any bugs found.
3. Run `npm test` after each fix to confirm nothing breaks.
4. Summarize what was changed.
