---
name: rhino-docs
description: Update documentation for an Rhino NestJS change — JSDoc, README, CLAUDE.md, and the Docusaurus docs site.
---

You are updating documentation for a change to an Rhino NestJS application or to the Rhino NestJS library itself.

## Step 1: Identify What Changed

Read the diff or ask the user what changed:
- New feature added?
- Existing behavior modified?
- Config option added or renamed?
- New CLI command?
- Bug fixed that users might have been working around?

## Step 2: Determine Which Docs Need Updates

| What changed | Docs to update |
|---|---|
| New `ModelRegistration` property | `README.md` config reference, `docs/server/nestjs/models.md` |
| New query parameter | `README.md` query conventions, `docs/server/nestjs/querying.md` |
| New feature (any) | `README.md` feature table, `CLAUDE.md` feature table, relevant Docusaurus page |
| Authorization behavior | `docs/server/nestjs/policies.md` |
| Multi-tenant behavior | `docs/server/nestjs/multi-tenancy.md` |
| Route group config | `docs/server/nestjs/route-groups.md` |
| Soft delete behavior | `docs/server/nestjs/soft-deletes.md` |
| Audit trail | `docs/server/nestjs/audit-trail.md` |
| Nested operations | `docs/server/nestjs/nested-operations.md` |
| Prisma migration flow | `docs/server/nestjs/models.md` |
| CLI command | `README.md` CLI section, `docs/server/nestjs/getting-started.md` |
| Blueprint YAML format | `docs/server/nestjs/blueprint.md` |
| Validation/Zod | `docs/server/nestjs/validation.md` |
| Request lifecycle | `docs/server/nestjs/request-lifecycle.md` |

## Step 3: README.md Updates

For new features, add a row to the feature summary table (keep the `#` numbering sequential):

```markdown
| 29 | **New Feature Name** | One-sentence description of what it does. |
```

For new `ModelRegistration` properties, add to the config reference section:

```markdown
| `newProperty` | `type` | Description of what it controls. |
```

For new query parameters, add to the query string conventions section with a `curl` example.

## Step 4: CLAUDE.md Updates

If the feature table in `CLAUDE.md` is affected, add a row:

```markdown
| 29 | **New Feature** | `new-service.ts`, `affected-controller.ts` |
```

If a development rule needs to be updated (e.g., new naming convention), update the relevant rule section.

## Step 5: Docusaurus Docs

The docs live at `../docs/docs/server/nestjs/`. Each file has a frontmatter block:

```markdown
---
sidebar_position: N
title: Page Title
---
```

When updating a page:
1. Find the correct page for the feature category.
2. Update or add code examples — all examples must use TypeScript/NestJS syntax, not PHP/Laravel.
3. Add `:::tip`, `:::info`, or `:::warning` callouts for important nuances.
4. If adding a new page, match the `sidebar_position` to slot it in the right order.

### Code Example Style

All code examples must follow NestJS conventions:

```typescript
// ✓ Correct — TypeScript, Zod, Prisma
const PostSchema = z.object({
  title: z.string().max(255),
  status: z.enum(['draft', 'published']),
});

posts: {
  model: 'post',
  validation: PostSchema,
}
```

```php
// ✗ Wrong — do not use PHP/Laravel examples in NestJS docs
protected $validationRules = ['title' => 'string|max:255'];
```

### Docusaurus Admonitions

```markdown
:::tip
Use `validationUpdate: schema.partial()` so all fields become optional on PUT requests.
:::

:::info
The `belongsToOrganization` flag works at the query level — it does not validate FK chains.
:::

:::warning
Never accept `organizationId` from the request body. Rhino strips it automatically.
:::
```

## Step 6: JSDoc in Source Code

For any changed service method, update or add JSDoc:

```typescript
/**
 * Applies the registered policy's `permittedAttributesForCreate()` to strip
 * forbidden fields and validates the remainder against the model's Zod schema.
 *
 * @throws never — returns a ValidationResult; caller decides how to respond.
 */
validateForAction<T>(data, reg, ctx): ValidationResult<T>
```

## Step 7: Verify Docs Build (Optional)

If the Docusaurus site has a local dev server:
```bash
cd ../docs && npm run start
```

Check that the page renders correctly and the sidebar order is right.

## Checklist

- [ ] Feature table in `README.md` updated
- [ ] Feature table in `CLAUDE.md` updated
- [ ] Config reference in `README.md` updated if new option added
- [ ] Relevant Docusaurus page(s) updated with NestJS code examples
- [ ] JSDoc on changed public methods updated
- [ ] No PHP/Laravel code examples in NestJS docs
