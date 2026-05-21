# 14 Cli Commands

**What it does:** NestJS CLI schematics for `rhino:install`, `rhino:generate`, `rhino:blueprint`, `rhino:export-postman`, `rhino:export-types`.

**Laravel equivalent:** `Commands/InstallCommand.php`, `Commands/GenerateCommand.php`, `Commands/BlueprintCommand.php`, `Commands/ExportPostmanCommand.php`, `Commands/ExportTypesCommand.php`.

**NestJS implementation:**

Use NestJS CLI plugins (`@nestjs/schematics`) or standalone CLI scripts:

```bash
npx rhino install          # Interactive setup
npx rhino generate         # Generate a single model
npx rhino blueprint        # Generate from YAML blueprints
npx rhino export-postman   # Generate Postman collection
npx rhino export-types     # Generate TypeScript types
```

The CLI is a separate entry point in the package:

```json
{
  "bin": {
    "rhino": "./dist/cli/index.js"
  }
}
```

**Install command** mirrors Laravel's interactive flow: prompts for features (multi-tenant, audit trail), test framework (jest), organization identifier column, roles.

**Files to create:**
- `/src/cli/index.ts`
- `/src/cli/commands/install.command.ts`
- `/src/cli/commands/generate.command.ts`
- `/src/cli/commands/blueprint.command.ts`
- `/src/cli/commands/export-postman.command.ts`
- `/src/cli/commands/export-types.command.ts`

**Dependencies:** 13 (blueprint system).

---
