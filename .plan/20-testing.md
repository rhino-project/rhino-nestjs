# 20 Testing

**What it does:** Test helpers, factory patterns, and documentation for testing Rhino NestJS apps.

**Laravel equivalent:** Test helpers in Laravel tests, `database/factories/`, `TestCase.php`.

**NestJS implementation:**

Provide test utilities:

```typescript
// Test helper for creating authenticated requests
export function createAuthenticatedAgent(app: INestApplication, user: User) {
  const token = jwtService.sign({ sub: user.id });
  return supertest(app.getHttpServer()).set('Authorization', `Bearer ${token}`);
}

// Test helper for seeding organizations with users
export async function seedOrganization(prisma: PrismaService, config: OrgSeedConfig) {
  const org = await prisma.organization.create({ data: config.org });
  const role = await prisma.role.create({ data: config.role });
  // ...
}

// Test helper for checking response format
export function expectRhinoResponse(response: any) {
  expect(response.body).toHaveProperty('data');
  expect(Array.isArray(response.body.data)).toBe(true);
}
```

**Files to create:**
- `/src/testing/test-helpers.ts`
- `/src/testing/test-module.ts`
- `/src/testing/factories/`

**Dependencies:** All features.

---
