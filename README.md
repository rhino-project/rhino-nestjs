# Rhino — NestJS

> Automatic REST API generation for NestJS + Prisma with built-in security, validation, and advanced querying.

[![Node Version](https://img.shields.io/badge/node-18%2B-green)](https://nodejs.org/)
[![NestJS Version](https://img.shields.io/badge/nestjs-10%2B-red)](https://nestjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @rhino-dev/rhino-nestjs
```

Then run the interactive installer:

```bash
npx rhino install
```

The installer walks you through:
- Connecting your Prisma client
- Enabling multi-tenancy
- Enabling audit trail
- Setting up Claude Code skills

## Minimum Working Example

### 1. Prisma Schema

```prisma title="prisma/schema.prisma"
model Post {
  id             Int          @id @default(autoincrement())
  title          String
  content        String?
  status         String       @default("draft")
  deletedAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  organizationId Int?
  organization   Organization? @relation(fields: [organizationId], references: [id])
}

model Organization {
  id        Int       @id @default(autoincrement())
  name      String
  slug      String    @unique
  posts     Post[]
  userRoles UserRole[]
  auditLogs AuditLog[]
}

model UserRole {
  id             Int          @id @default(autoincrement())
  userId         Int
  organizationId Int
  roleSlug       String
  permissions    Json         @default("[]")
  organization   Organization @relation(fields: [organizationId], references: [id])
}

model AuditLog {
  id             Int          @id @default(autoincrement())
  auditableType  String
  auditableId    String
  action         String
  oldValues      Json?
  newValues      Json?
  userId         Int?
  organizationId Int?
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime     @default(now())
  organization   Organization? @relation(fields: [organizationId], references: [id])
}
```

### 2. App Module

```typescript title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { RhinoModule } from '@rhino-dev/rhino-nestjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Module({
  imports: [
    RhinoModule.forRoot({
      models: {
        posts: {
          model: 'post',
          softDeletes: true,
          belongsToOrganization: true,
          hasAuditTrail: true,
          allowedFilters: ['status'],
          allowedSorts: ['createdAt', 'title'],
          defaultSort: '-createdAt',
          allowedIncludes: ['author'],
          allowedSearch: ['title', 'content'],
        },
      },
      routeGroups: {
        tenant: {
          prefix: ':organization',
          models: '*',
        },
      },
      multiTenant: {
        organizationIdentifierColumn: 'slug',
      },
      auth: {
        jwtSecret: process.env.JWT_SECRET,
      },
    }),
  ],
})
export class AppModule {}
```

> **Async variant:** `RhinoModule.forRootAsync({ useFactory: async (cfg: ConfigService) => ({...}), inject: [ConfigService] })`

### 3. Bootstrap (main.ts)

```typescript title="src/main.ts"
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  applyRhinoRouting,
} from '@rhino-dev/rhino-nestjs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  applyRhinoRouting(app, { prefix: 'api' });
  await app.listen(3000);
}
bootstrap();
```

That's it. You now have a full REST API for posts:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/:organization/posts` | List with filters, sorts, search, pagination |
| `POST` | `/api/:organization/posts` | Create with validation |
| `GET` | `/api/:organization/posts/:id` | Show single record |
| `PUT` | `/api/:organization/posts/:id` | Update with validation |
| `DELETE` | `/api/:organization/posts/:id` | Soft delete |
| `GET` | `/api/:organization/posts/trashed` | List soft-deleted records |
| `POST` | `/api/:organization/posts/:id/restore` | Restore soft-deleted record |
| `DELETE` | `/api/:organization/posts/:id/force-delete` | Permanent delete |

## Feature Summary

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Automatic CRUD Endpoints** | Generates `index`, `show`, `store`, `update`, `destroy` for every registered model. |
| 2 | **Authentication** | Login, logout, password recovery/reset, invitation-based registration via JWT. |
| 3 | **Authorization & Policies** | Convention-based permission checks (`{slug}.{action}`), wildcard support. |
| 4 | **Role-Based Access Control** | Per-org roles via `user_roles` pivot table. |
| 5 | **Attribute-Level Permissions** | Control which fields each role can read and write. |
| 6 | **Validation** | Zod schemas with role-keyed rules. Store and update schemas are independent. |
| 7 | **Cross-Tenant FK Validation** | Organization-id is automatically stripped from user input; org always comes from middleware. |
| 8 | **Filtering** | `?filter[field]=value` with comma-separated OR values. |
| 9 | **Sorting** | `?sort=-createdAt,title` — ascending and descending, multiple fields. |
| 10 | **Full-Text Search** | `?search=term` across configured fields, supports relationship dot notation. |
| 11 | **Pagination** | Header-based metadata (`X-Current-Page`, `X-Last-Page`, `X-Per-Page`, `X-Total`). |
| 12 | **Field Selection** | `?fields[posts]=id,title,status` to reduce payload. |
| 13 | **Eager Loading** | `?include=author,comments` with nested dot-notation. |
| 14 | **Multi-Tenancy** | Organization-based data isolation, auto-set `organizationId`, request scoping. |
| 15 | **Nested Ownership** | Auto-scopes by `organizationId` on the registered model. |
| 16 | **Route Groups** | Multiple URL prefixes with different middleware/auth (`tenant`, `public`, custom). Optional per-group `domain` constrains a group to a host (literal or `{organization}.example.com` subdomain). |
| 17 | **Soft Deletes** | Trash, restore, force-delete endpoints with individual permissions. |
| 18 | **Audit Trail** | Logs all CRUD events with old/new values, user, IP, and org context. |
| 19 | **Nested Operations** | `POST /nested` for atomic multi-model transactions with `$N.field` references. |
| 20 | **Invitations** | Token-based invite system with create, resend, cancel, accept, and role assignment. |
| 21 | **Hidden Columns** | Base + model-level + policy-level dynamic column hiding per role. |
| 22 | **Auto-Scope Discovery** | Custom `scopes` array per model registration; applies Prisma `where` additions. |
| 23 | **UUID Primary Keys** | `hasUuid: true` flag for string-based primary keys. |
| 24 | **Middleware Support** | Per-model `middleware` and per-action `actionMiddleware` arrays. |
| 25 | **Action Exclusion** | `exceptActions: ['destroy']` to disable specific CRUD routes. |
| 26 | **Generator CLI** | `rhino install`, `rhino generate`, `rhino blueprint`. |
| 27 | **Postman Export** | Auto-generated Postman Collection v2.1 with all endpoints. |
| 28 | **Blueprint System** | YAML-to-code generation for models, migrations, policies, tests, and seeders. |

## Configuration Reference

`RhinoModule.forRoot(config: RhinoConfig)` accepts:

### `models` (required)

A map of URL slug → model registration. The slug becomes the URL prefix and permission namespace.

```typescript
models: {
  // slug → ModelRegistration
  posts: {
    model: 'post',               // Prisma model name (matches prisma client key)
    policy: PostPolicy,          // Optional: custom ResourcePolicy subclass
    validation: PostSchema,      // Zod schema for all writes (store + update)
    validationStore: StoreSchema,  // Zod schema for POST only (overrides validation)
    validationUpdate: UpdateSchema, // Zod schema for PUT only (overrides validation)
    allowedFilters: ['status', 'userId'],
    allowedSorts: ['createdAt', 'title'],
    defaultSort: '-createdAt',
    allowedFields: ['id', 'title', 'status'],
    allowedIncludes: ['author', 'comments'],
    allowedSearch: ['title', 'content'],
    paginationEnabled: true,      // default: true
    perPage: 25,                  // default: 25
    softDeletes: true,            // enables trash/restore/force-delete endpoints
    belongsToOrganization: true,  // scopes queries to current org
    hasAuditTrail: true,          // enables automatic change logging
    hasUuid: false,               // use string UUIDs instead of int IDs
    additionalHiddenColumns: ['internalNotes'],
    auditExclude: ['password'],
    exceptActions: ['destroy'],   // disable DELETE endpoint
    middleware: [ThrottleMiddleware],
    actionMiddleware: { store: [VerifiedMiddleware] },
    owner: 'userId',              // parent FK field for nested ownership chains
    scopes: [PublishedScope],     // custom Prisma scope classes
  },
}
```

### `routeGroups`

```typescript
routeGroups: {
  tenant: {
    prefix: ':organization',     // URL prefix — :organization is the param name
    middleware: [ResolveOrganizationMiddleware],
    models: '*',                 // '*' or array of slugs: ['posts', 'comments']
    skipAuth: false,             // true = skip JWT guard (use for public groups)
  },
  public: {
    prefix: 'public',
    models: ['posts'],
    skipAuth: true,
  },
  // Domain-aware groups: constrain a group to a specific host. Two groups can
  // share the same prefix and be selected by host.
  admin: {
    domain: 'admin.example.com', // literal host — only this host serves this group
    models: '*',
  },
  hostTenant: {
    domain: '{organization}.example.com', // parameterized host — the captured
    models: '*',                          // {organization} subdomain resolves the
  },                                      // tenant, just like the :organization prefix
}
```

**`domain` (per-group, optional):**

- Omitted → the group matches any host (default; backward compatible).
- Literal host (`'admin.example.com'`) → only requests to that host resolve to the group; a wrong-host request to the group's models is rejected with `404`.
- Parameterized host (`'{organization}.example.com'`) → the captured `{organization}` subdomain feeds organization resolution (subdomain multitenancy), exactly like the `:organization` path prefix. Mirrors Laravel's `Route::domain(...)`.

Host-based matching is performed by `RouteGroupMiddleware`. For subdomain → organization resolution at the Express layer (analogous to `createTenantRouteRewrite`), use `createDomainRouteResolver({ prisma, config })` in `main.ts` before `applyRhinoRouting(...)`.

**Reserved group names:**

| Name | Behavior |
|------|----------|
| `tenant` | Invitation and nested operation routes are registered under this prefix |
| `public` | `skipAuth: true` is implied if set on the group |

### `multiTenant`

```typescript
multiTenant: {
  enabled: true,
  organizationIdentifierColumn: 'slug',  // 'id' | 'slug' | 'uuid' | any string
  organizationModel: 'organization',     // Prisma model name
  userOrganizationModel: 'userRole',     // Prisma model name
}
```

### `auth`

```typescript
auth: {
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '7d',
  userModel: 'user',           // Prisma model for users
  emailField: 'email',
  passwordField: 'password',
}
```

### `nested`

```typescript
nested: {
  path: 'nested',              // POST /{prefix}/nested
  maxOperations: 50,
  allowedModels: null,         // null = all registered models
}
```

### `invitations`

```typescript
invitations: {
  expiresDays: 7,
  allowedRoles: null,          // null = all roles
  notificationHandler: async (invitation) => { /* send email */ },
}
```

## Authorization Model

Permissions follow `{slug}.{action}` dot notation:

```
posts.index     — list posts
posts.show      — view a single post
posts.store     — create a post
posts.update    — update a post
posts.destroy   — soft delete a post
posts.trashed   — view trash
posts.restore   — restore from trash
posts.forceDelete — permanently delete
```

**Wildcard support:**

| Permission | Meaning |
|------------|---------|
| `*` | Full access to everything |
| `posts.*` | All actions on posts |
| `posts.index` | Exact match — list only |

**Storage:**
- Non-tenant routes: `users.permissions` (JSON column)
- Tenant routes: `user_roles.permissions` (JSON column, scoped per org)

## Query String Conventions

```bash
# Filtering — AND by default; comma-separated values are OR
GET /api/org/posts?filter[status]=published
GET /api/org/posts?filter[status]=draft,published

# Sorting — prefix with - for descending; comma-separate for multiple
GET /api/org/posts?sort=-createdAt
GET /api/org/posts?sort=status,-createdAt

# Full-text search
GET /api/org/posts?search=laravel

# Pagination
GET /api/org/posts?page=2&per_page=20

# Field selection
GET /api/org/posts?fields[posts]=id,title,status

# Eager loading — dot notation for nested
GET /api/org/posts?include=author,comments.user

# Combined
GET /api/org/posts?filter[status]=published&sort=-createdAt&include=author&page=1&per_page=20
```

**Pagination response headers:**
```
X-Current-Page: 2
X-Last-Page: 10
X-Per-Page: 20
X-Total: 195
```

## CLI Commands

```bash
# Interactive installation wizard
npx rhino install

# Scaffold a single resource (model registration, Zod schema, policy, test)
npx rhino generate

# Generate all models from YAML blueprints
npx rhino blueprint

# Generate a single model from a blueprint
npx rhino blueprint --model=posts

# Dry-run — preview without writing files
npx rhino blueprint --dry-run

# Force regeneration of unchanged blueprints
npx rhino blueprint --force

# Export Postman Collection v2.1
npx rhino export-postman
```

## Blueprint Quickstart

Blueprints generate models, migrations, policies, tests, and seeders from a YAML spec file. No tokens consumed.

```yaml title=".rhino/blueprints/posts.yaml"
model: Post
slug: posts

options:
  belongs_to_organization: true
  soft_deletes: true
  audit_trail: true

columns:
  title:
    type: string
    filterable: true
    sortable: true
    searchable: true
  content:
    type: text
    nullable: true
  status:
    type: string
    default: "draft"
    filterable: true

permissions:
  admin:
    actions: [index, show, store, update, destroy]
    show_fields: "*"
    create_fields: [title, content, status]
    update_fields: [title, content, status]
  viewer:
    actions: [index, show]
    show_fields: [id, title, status]
    create_fields: []
    update_fields: []
```

```bash
npx rhino blueprint
```

## License

MIT — see [LICENSE](LICENSE) for details.
