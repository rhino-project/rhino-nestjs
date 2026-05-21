# 17 Typescript Export

**What it does:** Exports TypeScript interfaces from registered Prisma models. Uses the Prisma schema to generate types, optionally via OpenAPI intermediate format.

**Laravel equivalent:** `Commands/ExportTypesCommand.php`.

**NestJS implementation:**

Since Prisma already generates TypeScript types, this command mainly re-exports them in a format consumable by frontend apps. It generates a single `.d.ts` file with all model interfaces.

**Files to create:**
- `/src/cli/commands/export-types.command.ts`
- `/src/exporters/typescript-exporter.ts`

**Dependencies:** 02, 14.

---
