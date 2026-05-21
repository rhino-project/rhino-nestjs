---
name: rhino-audit
description: Enable the audit trail on an Rhino NestJS model — Prisma schema, model registration, exclusions, and tests.
---

You are enabling the audit trail for one or more models in an Rhino NestJS application.

## Step 1: Read Context

Read:
- `prisma/schema.prisma` — check if `AuditLog` model already exists.
- `src/app.module.ts` — current model registrations.
- `src/services/audit.service.ts` — understand what is logged and how.
- `CLAUDE.md` — development rules.

## Step 2: Add the AuditLog Prisma Model

If `AuditLog` does not already exist in `prisma/schema.prisma`, add it:

```prisma
model AuditLog {
  id             Int       @id @default(autoincrement())
  auditableType  String
  auditableId    String
  action         String    // created | updated | deleted | forceDeleted | restored
  oldValues      Json?
  newValues      Json?
  userId         Int?
  organizationId Int?
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime  @default(now())
}
```

Run migration:
```bash
npx prisma migrate dev --name add_audit_logs
npx prisma generate
```

## Step 3: Enable Audit Trail on the Model

In `app.module.ts`, set `hasAuditTrail: true` and configure `auditExclude` for any sensitive fields:

```typescript
users: {
  model: 'user',
  hasAuditTrail: true,
  auditExclude: ['password', 'rememberToken', 'twoFactorSecret'],
  // ... rest of config
}
```

`AuditService` automatically excludes `password` and `rememberToken` by default. The `auditExclude` array adds to this list.

## Step 4: Verify What Gets Logged

The `GlobalController` calls `AuditService.log()` after each mutation. The following events are logged automatically:

| Event | Action recorded | Old values | New values |
|-------|----------------|------------|------------|
| `POST /posts` (create) | `created` | `null` | All new fields |
| `PUT /posts/:id` (update) | `updated` | Changed fields before | Changed fields after |
| `DELETE /posts/:id` (soft delete) | `deleted` | All fields | `null` |
| `POST /posts/:id/restore` | `restored` | `null` | All current fields |
| `DELETE /posts/:id/force-delete` | `forceDeleted` | All fields | `null` |

On update, only the fields that actually changed are recorded (via `AuditService.diff()`).

## Step 5: Query the Audit Trail via API

If `hasAuditTrail: true` is set, the audit endpoint is available automatically:

```bash
GET /api/:org/posts/:id/audit
GET /api/:org/posts/:id/audit?page=1&per_page=20
```

Response:
```json
[
  {
    "id": 1,
    "action": "created",
    "userId": 5,
    "auditableType": "post",
    "auditableId": "42",
    "oldValues": null,
    "newValues": { "title": "Hello", "status": "draft" },
    "ipAddress": "192.168.1.1",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

## Step 6: Write Tests

Create or update the spec file for this model:

```typescript
describe('Audit trail for posts', () => {
  it('creates an audit log entry when a post is created', async () => {
    await request(app.getHttpServer())
      .post('/api/test-org/posts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Hello', content: 'World' })
      .expect(201);

    const log = await prisma.client.auditLog.findFirst({
      where: { auditableType: 'post', action: 'created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log.newValues).toMatchObject({ title: 'Hello' });
    expect(log.oldValues).toBeNull();
  });

  it('logs only changed fields on update', async () => {
    const post = await prisma.client.post.create({ data: { title: 'Original', status: 'draft' } });

    await request(app.getHttpServer())
      .put(`/api/test-org/posts/${post.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Updated' })
      .expect(200);

    const log = await prisma.client.auditLog.findFirst({
      where: { auditableType: 'post', action: 'updated', auditableId: String(post.id) },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.oldValues).toMatchObject({ title: 'Original' });
    expect(log.newValues).toMatchObject({ title: 'Updated' });
    // status was not changed — should not appear
    expect(log.oldValues).not.toHaveProperty('status');
  });

  it('does not log excluded fields', async () => {
    const user = await prisma.client.user.create({
      data: { email: 'test@test.com', password: 'hashed' },
    });

    await request(app.getHttpServer())
      .put(`/api/admin/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'newpassword' })
      .expect(200);

    const log = await prisma.client.auditLog.findFirst({
      where: { auditableType: 'user', auditableId: String(user.id), action: 'updated' },
      orderBy: { createdAt: 'desc' },
    });
    // password must NEVER appear in audit logs
    expect(log?.newValues).not.toHaveProperty('password');
    expect(log?.oldValues).not.toHaveProperty('password');
  });

  it('records organizationId in the audit log for tenant routes', async () => {
    await request(app.getHttpServer())
      .post('/api/test-org/posts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Test' })
      .expect(201);

    const log = await prisma.client.auditLog.findFirst({
      where: { action: 'created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.organizationId).toBe(testOrg.id);
  });
});
```

Run:
```bash
npm test
```

## Common Mistakes

- **AuditLog model missing**: `AuditService.log()` silently swallows errors if the `auditLog` Prisma model does not exist. Add the model and re-run migrations.
- **auditExclude not set**: Always exclude `password`, `rememberToken`, and any token/secret fields. The default exclusions only cover `password` and `rememberToken`.
- **Direct Prisma calls bypass audit**: Only mutations going through `GlobalController` → `AuditService` are logged. If you call `prisma.client.post.update()` directly in a custom service, those changes are NOT audited. Use `ResourceService.update()` instead.
- **Nested operations**: Mutations via `POST /nested` do NOT currently produce audit logs (known gap — see `MISSING_FEATURES.md`).
