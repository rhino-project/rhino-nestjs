---
name: rhino-policy
description: Create or update an Rhino ResourcePolicy for a NestJS model — action permissions, attribute permissions, and role-based logic.
---

You are creating or updating an authorization policy for an Rhino NestJS model.

## Step 1: Understand the Permission Model

Rhino policies check `{slug}.{action}` permissions. The base `ResourcePolicy` class handles this automatically. You only need to subclass it to:

1. Restrict which fields users can **write** (`permittedAttributesForCreate` / `permittedAttributesForUpdate`)
2. Restrict which fields users can **read** (`permittedAttributesForShow` / `hiddenAttributesForShow`)
3. Add custom authorization logic beyond permission checks (e.g., "only the author can edit")

Read the following before writing any code:
- `src/policies/resource-policy.ts` — the base class
- `src/utils/permission-matcher.ts` — how `userHasPermission` and `resolveUserRoleSlug` work
- `prisma/schema.prisma` — understand the model's fields
- Existing policy files in `src/policies/`

## Step 2: Identify the Permission Matrix

Ask the user (or read the blueprint YAML) to define:

| Role | index | show | store | update | destroy | Hidden fields | Create fields | Update fields |
|------|-------|------|-------|--------|---------|---------------|---------------|---------------|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | none | `*` | `*` |
| editor | ✓ | ✓ | ✓ | ✓ | — | none | `[title, content]` | `[title, content]` |
| viewer | ✓ | ✓ | — | — | — | `[cost]` | — | — |

## Step 3: Create the Policy File

Create `src/policies/[model].policy.ts`:

```typescript
import { ResourcePolicy } from '@rhino-project/rhino-nestjs';

export class PostPolicy extends ResourcePolicy {
  // ── Action Authorization ──────────────────────────────────────
  // Only needed if you want custom logic BEYOND the {slug}.{action} check.
  // The base class already handles standard permission checks.

  // Example: restrict update to the record's owner (plus admin)
  update(user: any, model: any, organization?: any): boolean {
    if (!super.update(user, model, organization)) return false;
    if (this.hasRole(user, 'admin', organization)) return true;
    return model?.userId === user?.id;
  }

  // ── Field-Level Write Permissions ─────────────────────────────
  permittedAttributesForCreate(user: any): string[] {
    if (this.hasRole(user, 'admin')) return ['*'];
    if (this.hasRole(user, 'editor')) return ['title', 'content', 'categoryId'];
    return [];
  }

  permittedAttributesForUpdate(user: any): string[] {
    if (this.hasRole(user, 'admin')) return ['*'];
    if (this.hasRole(user, 'editor')) return ['title', 'content'];
    return [];
  }

  // ── Field-Level Read Permissions ──────────────────────────────
  // Return ['*'] to allow all fields (default).
  // Return a specific list to whitelist.
  permittedAttributesForShow(user: any): string[] {
    return ['*'];
  }

  // Return fields to ALWAYS hide for non-admin users.
  hiddenAttributesForShow(user: any): string[] {
    if (this.hasRole(user, 'admin')) return [];
    return ['costPrice', 'internalNotes'];
  }
}
```

## Step 4: Register the Policy

In `app.module.ts`, add `policy: PostPolicy` to the model registration:

```typescript
posts: {
  model: 'post',
  policy: PostPolicy,   // ← Add this
  // ... rest of config
}
```

## Step 5: Seed Permissions

Permissions are stored as JSON on `users.permissions` (non-tenant) or `user_roles.permissions` (tenant).

```typescript
// Non-tenant: assign directly on user
await prisma.user.update({
  where: { id: adminUser.id },
  data: { permissions: ['*'] },
});

// Tenant: assign via user_roles
await prisma.userRole.create({
  data: {
    userId: editorUser.id,
    organizationId: org.id,
    roleSlug: 'editor',
    permissions: ['posts.index', 'posts.show', 'posts.store', 'posts.update'],
  },
});
```

## Step 6: Write Policy Tests

Create a unit test file `src/policies/post.policy.spec.ts`:

```typescript
describe('PostPolicy', () => {
  let policy: PostPolicy;

  beforeEach(() => {
    policy = new PostPolicy();
    policy.resourceSlug = 'posts';
  });

  describe('permittedAttributesForCreate', () => {
    it('returns * for admin', () => {
      const user = makeUserWithRole('admin', org.id);
      expect(policy.permittedAttributesForCreate(user)).toEqual(['*']);
    });

    it('returns restricted fields for editor', () => {
      const user = makeUserWithRole('editor', org.id);
      expect(policy.permittedAttributesForCreate(user)).toEqual(
        expect.arrayContaining(['title', 'content'])
      );
      expect(policy.permittedAttributesForCreate(user)).not.toContain('status');
    });

    it('returns empty array for viewer', () => {
      const user = makeUserWithRole('viewer', org.id);
      expect(policy.permittedAttributesForCreate(user)).toEqual([]);
    });
  });

  describe('hiddenAttributesForShow', () => {
    it('hides costPrice for non-admin', () => {
      const user = makeUserWithRole('viewer', org.id);
      expect(policy.hiddenAttributesForShow(user)).toContain('costPrice');
    });

    it('reveals all fields for admin', () => {
      const user = makeUserWithRole('admin', org.id);
      expect(policy.hiddenAttributesForShow(user)).toEqual([]);
    });
  });
});
```

Run:
```bash
npm test -- --testPathPattern=post.policy
```

## Common Mistakes

- Do not forget to call `super.update(...)` etc. in overridden action methods — skipping it bypasses the permission check entirely.
- `hasRole(user, 'admin')` checks the role in the current organization context stored on the user object. If organization context is not set, it returns false.
- Return `['*']` (not `[]`) from `permittedAttributesForShow` when all fields should be visible — `[]` means nothing is visible.
- The `resourceSlug` on the policy must match the key in `RhinoModule.forRoot({ models: { [slug]: ... } })`.

## Permission Reference

| Action | Permission checked | Policy method |
|--------|-------------------|---------------|
| GET (list) | `{slug}.index` | `viewAny` |
| GET (single) | `{slug}.show` | `view` |
| POST | `{slug}.store` | `create` |
| PUT/PATCH | `{slug}.update` | `update` |
| DELETE | `{slug}.destroy` | `delete` |
| GET trashed | `{slug}.trashed` | `viewTrashed` |
| POST restore | `{slug}.restore` | `restore` |
| DELETE force | `{slug}.forceDelete` | `forceDelete` |
