# Rhino NestJS Server — Development Guide

This is **Rhino**, a NestJS package that auto-generates fully-featured REST APIs from model definitions registered in a configuration object. It is a TypeScript library (not an application) — you are editing the framework itself, not a project that uses it.

## Project Structure

```
src/
├── rhino.module.ts          # Dynamic module: forRoot() / forRootAsync()
├── rhino.config.ts          # RhinoConfigService + normalizeConfig()
├── index.ts                     # Public API barrel
├── constants/
│   └── tokens.ts                # DI injection tokens
├── interfaces/
│   └── rhino-config.interface.ts  # All config interfaces
├── controllers/
│   ├── global.controller.ts     # Main CRUD controller — ALL model endpoints
│   ├── auth.controller.ts       # Login, logout, password recovery, registration
│   ├── invitation.controller.ts # Invitation CRUD + accept
│   └── nested.controller.ts     # POST /nested atomic operations
├── services/
│   ├── resource.service.ts      # Core CRUD logic via Prisma
│   ├── query-builder.service.ts # Filters, sorts, search, pagination, includes
│   ├── serializer.service.ts    # Hidden columns, permitted attributes, formatting
│   ├── validation.service.ts    # Zod schema resolution, role-keyed rules
│   ├── organization.service.ts  # Org resolution and membership checks
│   ├── auth.service.ts          # JWT issuance, bcrypt, password recovery
│   ├── invitation.service.ts    # Invitation token management
│   ├── audit.service.ts         # AuditLog writes + diff calculation
│   ├── nested.service.ts        # Nested operations executor ($N.field refs)
│   ├── scope.service.ts         # Custom scope application
│   └── route-registration.service.ts  # applyRhinoRouting() + describeRoutes()
├── guards/
│   ├── resource-policy.guard.ts # Convention-based permission checking
│   └── jwt-auth.guard.ts        # JWT authentication guard
├── middleware/
│   └── resolve-organization.middleware.ts  # Org resolution from route params
├── interceptors/
│   └── response.interceptor.ts  # Wraps responses, sets pagination headers
├── decorators/
│   └── index.ts                 # @RhinoModel, @BelongsToOrganization, etc.
├── policies/
│   └── resource-policy.ts       # Base ResourcePolicy class
├── prisma/
│   ├── prisma.service.ts        # PrismaService wrapper (setClient + model())
│   ├── prisma-soft-delete.extension.ts
│   └── prisma-uuid.extension.ts
├── exporters/
│   └── postman-exporter.ts      # Postman Collection v2.1 generator
├── blueprint/
│   ├── blueprint-parser.ts      # YAML → Blueprint object
│   ├── blueprint-validator.ts   # Schema validation
│   └── generators/              # model/migration/policy/test/seeder generators
├── cli/
│   └── commands/
│       └── install.command.ts   # npx rhino install
└── utils/
    └── permission-matcher.ts    # userHasPermission + resolveUserRoleSlug
test/
├── e2e/                         # HTTP endpoint tests (supertest)
└── unit/                        # Service and guard unit tests
stubs/
└── skills/                      # Claude Code slash command .md files
```

## Features

This library provides the following features. When modifying or extending any of them, understand how they interconnect:

| # | Feature | Key Files |
|---|---------|-----------|
| 1 | **Automatic CRUD Endpoints** | `global.controller.ts`, `resource.service.ts` |
| 2 | **Authentication** | `auth.controller.ts`, `auth.service.ts`, `jwt-auth.guard.ts` |
| 3 | **Authorization & Policies** | `resource-policy.guard.ts`, `policies/resource-policy.ts` |
| 4 | **Role-Based Access Control** | `utils/permission-matcher.ts`, `resource-policy.guard.ts` |
| 5 | **Attribute-Level Permissions** | `serializer.service.ts`, `validation.service.ts`, `resource-policy.ts` |
| 6 | **Validation** | `validation.service.ts` (Zod schemas, role-keyed) |
| 7 | **Cross-Tenant FK Validation** | `validation.service.ts` (strips `organizationId` from input) |
| 8 | **Filtering** | `query-builder.service.ts` (`buildWhere`) |
| 9 | **Sorting** | `query-builder.service.ts` (`buildOrderBy`) |
| 10 | **Full-Text Search** | `query-builder.service.ts` (`buildWhere` with `OR` fragments) |
| 11 | **Pagination** | `resource.service.ts`, `response.interceptor.ts` |
| 12 | **Field Selection** | `query-builder.service.ts` (`buildSelect`) |
| 13 | **Eager Loading** | `query-builder.service.ts` (`buildInclude`) |
| 14 | **Multi-Tenancy** | `organization.service.ts`, `resolve-organization.middleware.ts`, `resource.service.ts` |
| 15 | **Nested Ownership** | `resource.service.ts` (`orgFilter`) |
| 16 | **Route Groups** (incl. domain-aware groups via per-group `domain`) | `rhino-config.interface.ts`, `route-registration.service.ts`, `middleware/route-group.middleware.ts`, `middleware/domain-route-resolver.ts`, `utils/domain-pattern.ts` |
| 17 | **Soft Deletes** | `resource.service.ts`, `global.controller.ts` |
| 18 | **Audit Trail** | `audit.service.ts`, `global.controller.ts` |
| 19 | **Nested Operations** | `nested.controller.ts`, `nested.service.ts` |
| 20 | **Invitations** | `invitation.controller.ts`, `invitation.service.ts` |
| 21 | **Hidden Columns** | `serializer.service.ts` |
| 22 | **Auto-Scope Discovery** | `scope.service.ts`, `ModelRegistration.scopes` |
| 23 | **UUID Primary Keys** | `resource.service.ts` (`castId`), `prisma-uuid.extension.ts` |
| 24 | **Middleware Support** | `ModelRegistration.middleware` / `actionMiddleware` |
| 25 | **Action Exclusion** | `global.controller.ts` (`assertActionAllowed`) |
| 26 | **Generator CLI** | `cli/commands/install.command.ts` |
| 27 | **Postman Export** | `exporters/postman-exporter.ts` |
| 28 | **Blueprint System** | `blueprint/blueprint-parser.ts`, `blueprint/generators/` |
| 29 | **Group Membership** (opt-in via `auth.enforceGroupMembership`) | `services/membership.service.ts`, `guards/group-membership.guard.ts`, `utils/permission-matcher.ts` |
| 30 | **Group-Aware Auth & Lifecycle Hooks** | `controllers/auth.controller.ts`, `services/auth-hooks.service.ts`, `rhino-config.interface.ts` (`AuthLifecycleHooks`, per-group `auth`/`hooks`), `services/invitation.service.ts` (`route_group`) |
| 31 | **Named Scopes** (`?scope=<key>`) | `services/scope.service.ts` (`RhinoNamedScope`, `applyNamed` — own-property + instance guard, AND-wrap), `services/query-builder.service.ts` (`build(..., { namedScopes })` whitelist + non-string reject), `services/resource.service.ts` (`findAll` applies it, fails closed when `ScopeService` absent), `rhino-config.interface.ts` (`namedScopes`/`defaultScope`), `rhino.config.ts` (`normalizeConfig` boot validation) |

### Group-auth hooks & token revocation (feature 30) — operator notes

- **Token revocation is advisory unless a `RevokedToken` model exists.** On hook
  rejection of `afterLogin`/`afterRegister`, the controller always drops the
  token from the response (the bounded guarantee) and *attempts* to denylist it
  via a `RevokedToken` Prisma model (`token`, `createdAt`). With no such model,
  `AuthService.revokeToken` logs a WARNING and skips the denylist — so consumers
  relying on revocation MUST provision `RevokedToken` **and** use short-TTL JWTs
  (`auth.jwtExpiresIn`).
- **Hooks must throw `RhinoAuthRejected`/`HttpException` to control status.** A
  plain `Error` is not an `HttpException` → it becomes a 500 (after the token is
  revoked). Default reject status is 403.
- **`afterPasswordRecover` must never become an enumeration oracle.** Its
  rejection is swallowed in the controller so the recovery endpoint's response
  is uniform whether or not the email exists. Reject semantics are preserved for
  login/register/logout/reset.
- **Invitation authorization** (`controllers/invitation.controller.ts`): under
  enforcement, a coarse membership gate (inviter must be a member of the target
  group — **403** on denial, NULL row = wildcard) runs first, then the normal
  permission check. A forged/unknown `routeGroup` (not configured, not `public`)
  is rejected with **422** regardless of enforcement.
- **Default group is a first-class membership dimension.** `RouteGroupMiddleware`
  resolves `__routeGroup` to the empty-prefix/default group's name (not
  `undefined`), so membership enforcement applies uniformly to it.
- **Membership is enforced at `/auth/login`, not only at the resource layer.**
  When enforcement is ON, `AuthController.login` runs the coarse membership gate
  (`AuthController.assertGroupMembership`) right after authenticating and BEFORE
  the `afterLogin` hook: a non-member is rejected with **403**
  (`MEMBERSHIP_DENIED`) and the just-issued token is revoked (best-effort) and
  never returned — matching the Laravel/Rails AuthControllers. The check keys off
  the resolved `__routeGroup`/`organization` and skips only the `public` group.
  It deliberately does NOT bail on `req.__skipAuth` (consumers set that on auth
  entrypoints to bypass the JWT guard — it is not a "skip membership" signal).

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# Run a specific test file
npx jest src/services/resource.service.spec.ts

# Run tests matching a pattern
npx jest --testNamePattern="it lists posts"
```

**All tests MUST pass before any change is considered complete.**

## Development Rules

### 1. Tests Are Mandatory — No Exceptions

Every change to this library MUST include tests:

- **New feature**: Write e2e tests (HTTP endpoint behavior via supertest) AND unit tests (individual service/guard logic). Cover ALL scenarios:
  - Happy path (200, 201)
  - Authorization denied (403)
  - Not found (404)
  - Validation errors (422)
  - Role-based access for EVERY permission level
  - Multi-tenant isolation (org A data must not leak to org B)
  - Edge cases (empty data, null values, max limits)

- **Bug fix**: Write a test that reproduces the bug FIRST (it should fail), then fix the code (test should pass). This prevents regressions.

- **Refactor**: All existing tests must continue to pass. Add tests for any edge cases discovered during refactoring.

**Test coverage goal: maximum. Every public method, every endpoint, every permission boundary.**

Test files live next to the source files they test: `resource.service.spec.ts` alongside `resource.service.ts`.

### 2. All Existing Tests Must Pass

Before finishing any change, run the full test suite:

```bash
npm test
```

If any test fails, fix it. Do NOT skip or disable tests.

### 3. Update Documentation for Every Feature Change

When you add or modify a feature, you MUST also update:

1. **CLAUDE.md** (this file) — Update the features table if adding a new feature.
2. **README.md** — Update the feature summary table if adding a new feature.

**Docs are the source of truth for users and AI assistants. If they're outdated, users get wrong information.**

### 4. Maintain Consistency Across Stacks

Rhino exists in three stacks (Laravel, NestJS, Rails). When adding a feature to this NestJS version:

- Check if the same feature should be reflected in `../server-laravel/` and any Rails version.
- Keep the API surface (URL patterns, query parameters, response format, behavior) identical across stacks.
- Keep the Blueprint YAML format identical across stacks.

### 5. Code Conventions

- TypeScript strict mode — all parameters and returns must be typed.
- Use NestJS `@Injectable()` services for business logic.
- Keep `GlobalController` as the single CRUD handler — do NOT create per-model controllers.
- New services go in `src/services/`, new guards in `src/guards/`.
- Configuration interfaces go in `src/interfaces/rhino-config.interface.ts`.
- Validation schemas use Zod, not class-validator. No DTOs with decorators.
- Use `RhinoConfigService` (injected via DI) to read config — never read raw env vars in service files.
- Prisma models are accessed via `PrismaService.model(name)`, never via a direct import.
- All new config keys must have sensible defaults in `normalizeConfig()` inside `rhino.config.ts`.

### 6. Multi-Tenancy Safety

When modifying any code that touches data:
- NEVER trust client-supplied `organizationId`.
- Always use the org from `req.organization` (set by `ResolveOrganizationMiddleware`), never from user input.
- `ValidationService` automatically strips `organizationId`/`organization_id` from the incoming body when inside a tenant context — do not remove this check.
- Test cross-tenant isolation: create data in org A, request from org B, verify 404/empty response.

### 7. Zod Validation Design

The library uses Zod, not class-validator. Key rules:

- `ModelRegistration.validation` — base schema applied to both store and update.
- `ModelRegistration.validationStore` / `validationUpdate` — override per action.
- Role-keyed schemas: pass `Record<string, ZodSchema>` keyed by role slug. A `'*'` key is the fallback.
- `ValidationService.validateForAction()` intersects the schema with the policy's `permittedAttributesFor{Create,Update}()`.
- Never use `.partial()` at the schema level to handle update semantics — let the permitted-attrs intersection do it.

### 8. Backward Compatibility

This is a published package. Breaking changes require:
- Major version bump.
- Migration guide in docs.
- Deprecation notice in the previous minor version when possible.

## Key Architectural Decisions

1. **Config-based model registration** (`forRoot` / `forRootAsync`) mirrors Laravel's `config/rhino.php`. Decorator-based registration (`@RhinoModel()`) is an alternative, opt-in path.

2. **Guards, not middleware, for authorization.** `ResourcePolicyGuard` checks `{slug}.{action}` permissions via `userHasPermission()`. Middleware only handles org resolution.

3. **Interceptors for response formatting.** `ResponseInterceptor` wraps responses in `{ data: [...] }` and sets pagination headers.

4. **Dynamic module.** `RhinoModule.forRoot(config)` is `@Global()` so all core services are available throughout the consuming application.

5. **No decorator-on-entity pattern.** Prisma keeps the schema separate from application code. Rhino model configuration lives in the `ModelRegistration` object, not in Prisma schema annotations.
