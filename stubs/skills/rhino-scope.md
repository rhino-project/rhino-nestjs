---
name: rhino-scope
description: Create a custom query scope for an Rhino NestJS model — filters additional records via a Prisma where clause applied globally to all queries.
---

You are creating a custom scope for an Rhino NestJS model. Scopes add automatic `where` conditions to every query for the model, similar to Eloquent global scopes in Laravel.

## Step 1: Understand When to Use a Scope

Use a custom scope when:
- Every query for a model should automatically include a filter (e.g., `isVisible: true`)
- The filter depends on request context (e.g., a driver only sees their own trips)
- You need to apply soft-visibility flags or tenant-adjacent filtering

Do NOT use a scope when:
- The filter is already handled by `belongsToOrganization: true` (org scoping is built in)
- The filter is something users can control via `?filter[field]=value`

## Step 2: Read Context

Read:
- `src/app.module.ts` — the model's current registration config
- `src/services/scope.service.ts` — how scopes are applied to Prisma queries
- `prisma/schema.prisma` — the model's fields

## Step 3: Define the Scope Class

Create `src/scopes/[model]-scope.ts`. A scope is a plain class with an `apply` method that returns Prisma `where` conditions:

```typescript
// src/scopes/post.scope.ts

export class PublishedPostScope {
  /**
   * Applies to every findMany/findFirst/count query for this model.
   * Return a Prisma where fragment to merge into the query.
   */
  apply(context: { user?: any; organization?: any }): Record<string, any> {
    // Only show published posts to non-admin users
    if (!context.user) {
      return { status: 'published' };
    }
    // Admins see everything — return empty object to add no filter
    return {};
  }
}
```

For a context-aware scope that filters by user:

```typescript
// src/scopes/driver-trip.scope.ts

export class DriverTripScope {
  apply(context: { user?: any; organization?: any }): Record<string, any> {
    if (!context.user?.driverId) return {};
    return { driverId: context.user.driverId };
  }
}
```

## Step 4: Register the Scope

Add the scope class to the model's `scopes` array in `RhinoModule.forRoot()`:

```typescript
import { PublishedPostScope } from './scopes/post.scope';

// In app.module.ts
posts: {
  model: 'post',
  scopes: [PublishedPostScope],   // ← Add here
  // ... rest of config
}
```

Multiple scopes are merged with AND logic:

```typescript
trips: {
  model: 'trip',
  scopes: [ActiveTripScope, DriverTripScope],
}
```

## Step 5: Write Tests

Create `src/scopes/post.scope.spec.ts`:

```typescript
import { PublishedPostScope } from './post.scope';

describe('PublishedPostScope', () => {
  const scope = new PublishedPostScope();

  it('filters to published posts for unauthenticated users', () => {
    const where = scope.apply({ user: undefined });
    expect(where).toEqual({ status: 'published' });
  });

  it('returns empty filter for admin users', () => {
    const adminUser = { id: 1, permissions: ['*'] };
    const where = scope.apply({ user: adminUser });
    expect(where).toEqual({});
  });
});
```

Write an e2e test that verifies the scope is applied during HTTP requests:

```typescript
it('excludes draft posts from the public listing', async () => {
  await prisma.post.createMany({
    data: [
      { title: 'Published', status: 'published' },
      { title: 'Draft', status: 'draft' },
    ],
  });

  const res = await request(app.getHttpServer())
    .get('/api/posts')
    .expect(200);

  const titles = res.body.data.map((p: any) => p.title);
  expect(titles).toContain('Published');
  expect(titles).not.toContain('Draft');
});
```

Run:
```bash
npm test
```

## Common Mistakes

- Scopes apply to ALL queries including `findOne` and `count`. Make sure the scope does not accidentally hide records that users expect to find by ID.
- Returning `{}` from `apply()` adds no filter — safe default for "no restriction needed".
- Scopes are AND-merged with the org filter and user-supplied filters. Do not add an `AND: [...]` wrapper yourself.
- Do not use `req.user` or `request()` inside a scope class — the user context is passed as a parameter.

## Named Scopes (`?scope=<key>`) — client-selectable, opt-in

The `scopes` array above is a *global* scope: it applies to every query, always.
A **named scope** is different — it is client-selectable via `?scope=<key>` and
applies only to `index`/`trashed` (not `show`/`update`/`destroy`). Implement
`RhinoNamedScope` (from the package root) — its `apply(ctx)` takes **only** the
context and returns a Prisma where-*fragment*; Rhino AND-wraps it into the query,
so a named scope can never drop the org/filter/search/soft-delete constraints
(do NOT add your own `AND: [...]` wrapper here).

```typescript
import type { RhinoNamedScope, ScopeContext } from '@rhino-dev/rhino-nestjs';

export class AvailableForDriversScope implements RhinoNamedScope {
  apply(ctx: ScopeContext): Record<string, any> {
    if (!ctx.user) return { id: { in: [] } };   // fail closed with no user
    return { status: 'active', ownerId: ctx.user.id };
  }
}

export class ActiveScope implements RhinoNamedScope {
  apply(): Record<string, any> {
    return { status: 'active' };
  }
}
```

Register the callable keys on the model. Only declared keys are callable; an
unknown or prototype key (`?scope=constructor`) is rejected with **403**. A
non-string `?scope` (repeated/array param) is also **403**. `defaultScope` is
applied when no `?scope` is sent and is validated at boot to be a declared key.

```typescript
routes: {
  model: 'route',
  namedScopes: {
    active: ActiveScope,
    availableForDrivers: AvailableForDriversScope,
  },
  defaultScope: 'active',   // must be a key of namedScopes
}
```
