# 13 Blueprint System

**What it does:** Generates models (Prisma schema additions), policies, tests, seeders, and factories from YAML blueprint files. The YAML format is identical across Laravel, Rails, and NestJS.

**Laravel equivalent:** `Blueprint/BlueprintParser.php`, `Blueprint/BlueprintValidator.php`, `Blueprint/Generators/*`, `Commands/BlueprintCommand.php`.

**NestJS implementation:**

The blueprint YAML format is identical to Laravel:

```yaml
model: Project
slug: projects
table: projects
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
  description:
    type: text
    nullable: true
  status:
    type: string
    default: draft
    filterable: true
permissions:
  admin:
    actions: ["*"]
    show_fields: "*"
    create_fields: { title: required, description: nullable, status: nullable, budget: nullable }
    update_fields: { title: sometimes, description: nullable, status: nullable, budget: nullable }
  viewer:
    actions: [index, show]
    show_fields: [id, title, description, status]
    hidden_fields: [budget, internal_notes]
```

The NestJS generators produce:
1. **Prisma schema fragment** (appended to `schema.prisma`)
2. **Resource definition file** with Zod validation, model config
3. **Policy class** with role-based permissions
4. **Jest test file** with CRUD, authorization, and multi-tenant tests
5. **Seed file** with realistic data

**Files to create:**
- `/src/blueprint/blueprint-parser.ts`
- `/src/blueprint/blueprint-validator.ts`
- `/src/blueprint/manifest-manager.ts`
- `/src/blueprint/generators/prisma-schema-generator.ts`
- `/src/blueprint/generators/resource-definition-generator.ts`
- `/src/blueprint/generators/policy-generator.ts`
- `/src/blueprint/generators/test-generator.ts`
- `/src/blueprint/generators/seeder-generator.ts`

**Tests:** Parse valid YAML, validation errors on invalid structure, generator output matches expected, manifest tracks changes.

**Dependencies:** 01, 02.

---
