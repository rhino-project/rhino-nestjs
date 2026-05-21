# Master Plan

**Package name:** `@rhino-project/rhino-nestjs`

**Overview:** Rhino NestJS is a framework library that auto-generates fully-featured REST APIs from model definitions registered in a configuration object. It replaces the abandoned AdonisJS version with a NestJS implementation that faithfully reproduces the developer experience and feature set of the Laravel (PHP) and Rails (Ruby) versions.

**ORM choice: Prisma**

Rationale:
1. Prisma has the strongest TypeScript type generation. Every model query is fully typed, which eliminates an entire class of bugs that plagued the AdonisJS version (which used Lucid).
2. Prisma's schema-as-code approach mirrors Laravel's migration-first workflow. The `.prisma` schema file is the single source of truth, analogous to Laravel migrations.
3. Prisma's query builder API supports the filtering, sorting, pagination, and eager loading patterns needed by the GlobalController without requiring a third-party query builder.
4. MikroORM and TypeORM use decorators on model classes, which creates a conflict: Rhino's models would need to be both Prisma/TypeORM entities AND Rhino-decorated classes. Prisma keeps the schema separate from application logic.
5. Drizzle is too low-level; it does not provide the model lifecycle hooks needed for audit trail, soft deletes, and UUID generation.

**Key design decisions:**

1. **Decorators over config files.** NestJS is decorator-native. Models will be registered using `@RhinoModel()` decorators on "resource definition" classes rather than a config file. However, a `RhinoModule.forRoot({ models: {...} })` pattern is also supported for config-file registration (bridging the Laravel config/rhino.php pattern).

2. **Guards for authorization, not middleware.** NestJS Guards are the natural equivalent of Laravel's `Gate::authorize()`. A `ResourcePolicyGuard` will check `{slug}.{action}` permissions, exactly matching Laravel's `ResourcePolicy`.

3. **Interceptors for response formatting.** An `RhinoResponseInterceptor` wraps responses in `{ data: [...] }` and sets pagination headers (X-Current-Page, X-Last-Page, X-Per-Page, X-Total).

4. **Dynamic module with forRoot/forRootAsync.** `RhinoModule.forRoot(config)` accepts the full configuration including models map, route groups, multi-tenant settings, and nested operation config.

5. **NestJS CLI schematics for code generation.** The blueprint system uses `@angular-devkit/schematics` (the same engine NestJS CLI uses) to generate models, migrations, guards, tests, and seeders from YAML blueprints.

6. **Zod for validation (not class-validator).** Zod schemas are more composable, support role-keyed validation naturally, and generate TypeScript types. class-validator requires decorator-heavy DTOs that conflict with the dynamic schema approach needed by Rhino.

**Module architecture:**

```
@rhino-project/rhino-nestjs/
  src/
    rhino.module.ts            # Dynamic module: forRoot() / forRootAsync()
    rhino.config.ts            # Config interface and token
    controllers/
      global.controller.ts         # The single CRUD controller
      auth.controller.ts           # Login, logout, password recovery, registration
      invitation.controller.ts     # Invitation CRUD + accept
      nested.controller.ts         # POST /nested atomic operations
    services/
      resource.service.ts          # Core CRUD logic (Prisma operations)
      query-builder.service.ts     # Filters, sorts, search, pagination, includes
      serializer.service.ts        # Hidden columns, permitted attributes, response formatting
      validation.service.ts        # Zod schema resolution, role-keyed rules, cross-tenant FK
      organization.service.ts      # Org resolution and scoping
      auth.service.ts              # JWT/Passport auth operations
      invitation.service.ts        # Invitation token management
      audit.service.ts             # Change logging
      nested.service.ts            # Nested operations executor
    guards/
      resource-policy.guard.ts     # Convention-based permission checking
      auth.guard.ts                # JWT authentication guard
    middleware/
      resolve-organization.middleware.ts  # Org resolution from route params
    interceptors/
      response.interceptor.ts      # Wraps responses in {data:...}, sets headers
      hidden-columns.interceptor.ts # Removes hidden fields from responses
    decorators/
      rhino-model.decorator.ts # @RhinoModel() class decorator
      rhino-action.decorator.ts # Per-action metadata
      belongs-to-org.decorator.ts  # Multi-tenant marker
      has-audit-trail.decorator.ts # Audit trail marker
      has-uuid.decorator.ts        # UUID primary key marker
      hidable-columns.decorator.ts # Column visibility rules
      permitted-attrs.decorator.ts # Per-role writable fields
      except-actions.decorator.ts  # Exclude specific CRUD actions
    interfaces/
      rhino-config.interface.ts
      resource-definition.interface.ts
      policy.interface.ts
      route-group.interface.ts
    pipes/
      validation.pipe.ts           # Dynamic Zod validation pipe
    prisma/
      prisma.module.ts             # PrismaService wrapper
      prisma.service.ts
      prisma-soft-delete.extension.ts  # $extends for soft delete
      prisma-audit.extension.ts        # $extends for audit trail
      prisma-uuid.extension.ts         # $extends for UUID generation
      prisma-org-scope.extension.ts    # $extends for org scoping
    blueprint/
      blueprint-parser.ts          # YAML parsing
      blueprint-validator.ts       # Schema validation
      manifest-manager.ts          # Change tracking
      generators/
        model-generator.ts
        migration-generator.ts     # Prisma schema generation
        policy-generator.ts
        test-generator.ts
        seeder-generator.ts
    cli/
      schematics/                  # NestJS CLI schematics
        rhino-install/
        rhino-generate/
        rhino-blueprint/
        rhino-export-postman/
        rhino-export-types/
    skills/                        # Claude Code skills (.md files)
      rhino-feature.md
      rhino-model.md
      rhino-policy.md
      ... (13 total, matching Laravel)
    utils/
      slug.ts
      permission-matcher.ts
      fk-chain-walker.ts           # Cross-tenant FK validation
  test/
    e2e/
    unit/
```

**Feature priority:**

| Priority | Feature | Effort |
|----------|---------|--------|
| P0 | Project setup, config system, Prisma integration | 2 days |
| P0 | Automatic CRUD (GlobalController equivalent) | 3 days |
| P0 | Authentication (JWT login/logout/register) | 1 day |
| P0 | Authorization & Policies (ResourcePolicy guard) | 2 days |
| P0 | Validation (Zod, role-keyed) | 2 days |
| P0 | Query builder (filters, sorts, search, pagination, includes) | 3 days |
| P0 | Multi-tenancy (org scoping, middleware, auto-detect path) | 3 days |
| P0 | Route groups (tenant, public, custom) | 1 day |
| P0 | Hidden columns & permitted attributes | 1 day |
| P1 | Soft deletes (trash, restore, force-delete) | 1 day |
| P1 | Nested operations (atomic transactions) | 2 days |
| P1 | Audit trail | 1 day |
| P1 | UUID support | 0.5 day |
| P1 | Auto-scope discovery | 0.5 day |
| P1 | Middleware/interceptor support per model | 0.5 day |
| P1 | CLI commands (install, generate) | 2 days |
| P1 | Blueprint system (YAML to code) | 3 days |
| P1 | Testing utilities | 1 day |
| P2 | Invitation system | 1 day |
| P2 | Postman export | 1 day |
| P2 | TypeScript export | 1 day |
| P2 | Claude skills | 1 day |

**Total estimated effort:** ~33 developer-days for full feature parity.

**Development phases:**

- Phase 1 (MVP, ~2 weeks): P0 features. A working NestJS app can define models, get CRUD endpoints, authenticate, authorize, validate, query, and scope by organization.
- Phase 2 (v1.0, ~1.5 weeks): P1 features. Soft deletes, nested ops, audit trail, UUID, scopes, CLI, blueprint, testing.
- Phase 3 (v1.5, ~1 week): P2 features. Invitations, Postman export, TypeScript export, Claude skills.

**Lessons from AdonisJS (what NOT to do):**

1. The CLI commands must work when installed from npm tarball, not just from the registry. The AdonisJS version had ESM resolution issues that broke `node ace rhino:*` commands.
2. Serialization must exclude `deletedAt: null` from non-deleted records. The AdonisJS version leaked this field.
3. CSRF middleware must be properly configured for API-only use. NestJS does not have this issue by default.
4. Pagination must be implemented from day one, not left as a TODO.

---
