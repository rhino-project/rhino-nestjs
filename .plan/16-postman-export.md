# 16 Postman Export

**What it does:** Generates a Postman Collection v2.1 JSON file with all CRUD endpoints, query builder examples, and authentication routes.

**Laravel equivalent:** `Commands/ExportPostmanCommand.php`.

**NestJS implementation:**

Introspects the registered models, their allowed filters/sorts/includes, and route groups to generate a complete Postman collection.

**Files to create:**
- `/src/cli/commands/export-postman.command.ts`
- `/src/exporters/postman-exporter.ts`

**Dependencies:** 02, 14.

---
