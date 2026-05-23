---
name: rhino-test
description: Write comprehensive tests for an Rhino NestJS model — CRUD, authorization, validation, multi-tenant isolation, soft deletes, and audit trail.
---

You are writing tests for an Rhino NestJS model. This skill covers the full test matrix that all models must satisfy.

## Step 1: Read Before Testing

Read:
- `src/app.module.ts` — model registration, policies, and route groups
- `prisma/schema.prisma` — model fields and relations
- The policy file for this model
- Any existing spec files for this model

## Step 2: Test Setup Pattern

Use NestJS `TestingModule` with a real (or seeded) Prisma client. Keep test setup DRY with helper functions.

```typescript
// test/helpers.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@rhino-dev/rhino-nestjs';
import { AuthService } from '@rhino-dev/rhino-nestjs';

export async function createTestApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  return app;
}

export async function seedOrg(prisma: PrismaService, slug: string) {
  return prisma.client.organization.create({ data: { name: slug, slug } });
}

export async function seedUserWithRole(
  prisma: PrismaService,
  auth: AuthService,
  org: any,
  roleSlug: string,
  permissions: string[],
) {
  const user = await prisma.client.user.create({
    data: { email: `${roleSlug}@test.com`, password: await auth.hashPassword('password') },
  });
  await prisma.client.userRole.create({
    data: { userId: user.id, organizationId: org.id, roleSlug, permissions },
  });
  const { token } = await auth.login(user.email, 'password', undefined);
  return { user, token };
}
```

## Step 3: CRUD Test Matrix

Write these tests for every model. Replace `posts` with the actual slug and `Post`/`post` with the model name.

```typescript
describe('Posts API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: any;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    org = await seedOrg(prisma, 'test-org');
    ({ token: adminToken } = await seedUserWithRole(prisma, ..., org, 'admin', ['*']));
    ({ token: editorToken } = await seedUserWithRole(prisma, ..., org, 'editor', [
      'posts.index', 'posts.show', 'posts.store', 'posts.update',
    ]));
    ({ token: viewerToken } = await seedUserWithRole(prisma, ..., org, 'viewer', [
      'posts.index', 'posts.show',
    ]));
  });

  afterAll(async () => {
    await prisma.client.post.deleteMany();
    await app.close();
  });

  // ── INDEX ─────────────────────────────────────────────────────
  describe('GET /api/:org/posts', () => {
    it('returns 200 with paginated list for admin', async () => {
      await request(app.getHttpServer())
        .get('/api/test-org/posts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.headers['x-current-page']).toBeDefined();
          expect(res.headers['x-total']).toBeDefined();
        });
    });

    it('returns 403 when user lacks posts.index permission', async () => {
      const { token: noPermToken } = await seedUserWithRole(prisma, ..., org, 'none', []);
      await request(app.getHttpServer())
        .get('/api/test-org/posts')
        .set('Authorization', `Bearer ${noPermToken}`)
        .expect(403);
    });

    it('returns 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/test-org/posts')
        .expect(401);
    });
  });

  // ── SHOW ──────────────────────────────────────────────────────
  describe('GET /api/:org/posts/:id', () => {
    it('returns 200 with the post for admin', async () => { /* ... */ });
    it('returns 404 for a non-existent id', async () => { /* ... */ });
    it('returns 404 for a post from another org', async () => { /* ... multi-tenant isolation */ });
  });

  // ── STORE ─────────────────────────────────────────────────────
  describe('POST /api/:org/posts', () => {
    it('returns 201 for admin with valid payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test-org/posts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Hello World', content: 'Body text', status: 'draft' })
        .expect(201);
      expect(res.body.data.title).toBe('Hello World');
      // organizationId must NOT come from the request body
      expect(res.body.data.organizationId).toBeDefined();
    });

    it('returns 403 when viewer tries to create', async () => {
      await request(app.getHttpServer())
        .post('/api/test-org/posts')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Try' })
        .expect(403);
    });

    it('returns 403 when editor submits a forbidden field', async () => {
      await request(app.getHttpServer())
        .post('/api/test-org/posts')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Try', status: 'published' })  // 'status' not in editor's permittedAttrs
        .expect(403);
    });

    it('returns 422 when required field is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/test-org/posts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})  // empty body
        .expect(422);
      expect(res.body.errors).toBeDefined();
    });
  });

  // ── UPDATE ────────────────────────────────────────────────────
  describe('PUT /api/:org/posts/:id', () => {
    it('returns 200 for admin with partial update', async () => { /* ... */ });
    it('returns 404 for a post from another org', async () => { /* ... */ });
    it('ignores organizationId in the body', async () => { /* ... */ });
  });

  // ── DESTROY ───────────────────────────────────────────────────
  describe('DELETE /api/:org/posts/:id', () => {
    it('returns 204 for admin', async () => { /* ... */ });
    it('soft deletes (sets deletedAt) when softDeletes is enabled', async () => {
      // After DELETE, verify the record still exists but deletedAt is set
    });
    it('returns 403 for viewer', async () => { /* ... */ });
  });

  // ── SOFT DELETES ──────────────────────────────────────────────
  describe('GET /api/:org/posts/trashed', () => {
    it('lists only trashed posts for admin', async () => { /* ... */ });
  });

  describe('POST /api/:org/posts/:id/restore', () => {
    it('restores a trashed post for admin', async () => { /* ... */ });
  });

  describe('DELETE /api/:org/posts/:id/force-delete', () => {
    it('permanently deletes a post for admin', async () => { /* ... */ });
  });

  // ── MULTI-TENANT ISOLATION ────────────────────────────────────
  describe('Multi-tenant isolation', () => {
    it('does not return posts from org B when requesting as org A user', async () => {
      const orgB = await seedOrg(prisma, 'org-b');
      await prisma.client.post.create({ data: { title: 'OrgB Post', organizationId: orgB.id } });

      const res = await request(app.getHttpServer())
        .get('/api/test-org/posts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const titles = res.body.data.map((p: any) => p.title);
      expect(titles).not.toContain('OrgB Post');
    });
  });
});
```

## Step 4: Filtering and Query Tests

```typescript
describe('Querying', () => {
  it('filters posts by status', async () => { /* ?filter[status]=published */ });
  it('sorts posts by createdAt descending', async () => { /* ?sort=-createdAt */ });
  it('searches posts by title', async () => { /* ?search=hello */ });
  it('paginates posts', async () => { /* ?page=2&per_page=5 */ });
  it('includes related user', async () => { /* ?include=user */ });
  it('rejects disallowed filters', async () => { /* filter[internalNotes]=x → 400 */ });
});
```

## Step 5: Run and Fix

```bash
npm test -- --testPathPattern=posts
npm test  # full suite
```

All pre-existing tests must remain green.
