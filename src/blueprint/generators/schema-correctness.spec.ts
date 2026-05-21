/**
 * BP-002 — PrismaSchemaGenerator correctness:
 *   - Skip when the model already exists in the consumer's schema
 *   - Emit `@relation` for `foreignId` columns that name a `foreign_model`
 *   - Map `decimal` → `Float` on SQLite
 *   - Never emit duplicate models, duplicate enums, or bare FK columns
 *
 * Also tests `detectPrismaProvider` from the runner.
 */
import {
  PrismaSchemaGenerator,
  modelExistsInSchema,
  enumExistsInSchema,
} from './prisma-schema-generator';
import { BlueprintParser } from '../blueprint-parser';
import { detectPrismaProvider } from '../blueprint-runner';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function writeYaml(content: string, name = 'bp.yaml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-002-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content, 'utf8');
  return f;
}

describe('BP-002: PrismaSchemaGenerator correctness', () => {
  const parser = new BlueprintParser();
  const gen = new PrismaSchemaGenerator();

  // ----------------------------------------------------------------
  // modelExistsInSchema + enumExistsInSchema helpers
  // ----------------------------------------------------------------
  describe('schema introspection helpers', () => {
    const schema = `
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite"; url = "file:./dev.db" }

model Organization {
  id   Int    @id @default(autoincrement())
  slug String @unique
}

enum PostStatus {
  DRAFT
  PUBLISHED
}
`;

    it('detects existing models by exact name', () => {
      expect(modelExistsInSchema(schema, 'Organization')).toBe(true);
      expect(modelExistsInSchema(schema, 'Post')).toBe(false);
    });

    it('is whitespace-tolerant but name-strict', () => {
      expect(modelExistsInSchema(schema, 'organization')).toBe(false); // case-sensitive
      expect(modelExistsInSchema(schema, 'Org')).toBe(false); // no partial match
    });

    it('detects existing enums', () => {
      expect(enumExistsInSchema(schema, 'PostStatus')).toBe(true);
      expect(enumExistsInSchema(schema, 'TaskStatus')).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Skip existing models
  // ----------------------------------------------------------------
  describe('skips existing models (no duplicate `model Foo { ... }`)', () => {
    const POST_YAML = `
model: Post
options: { belongs_to_organization: true }
columns:
  title:
    type: string
relationships: []
permissions: {}
`.trim();

    it('returns empty string when the model is already declared in the schema', () => {
      const bp = parser.parseModel(writeYaml(POST_YAML));
      const existingSchema = `
model Post {
  id    Int    @id @default(autoincrement())
  title String
}`;
      const out = gen.generate(bp, { existingSchema });
      expect(out).toBe('');
    });

    it('emits the model when it is absent from the schema', () => {
      const bp = parser.parseModel(writeYaml(POST_YAML));
      const out = gen.generate(bp, { existingSchema: 'model Other { id Int @id }' });
      expect(out).toContain('model Post {');
    });

    it('emits the model when no existingSchema is provided', () => {
      const bp = parser.parseModel(writeYaml(POST_YAML));
      const out = gen.generate(bp);
      expect(out).toContain('model Post {');
    });

    it('does not redeclare enums that already exist', () => {
      const POST_WITH_ENUM = `
model: Post
options: {}
columns:
  status:
    type: enum
    values: [draft, published]
relationships: []
permissions: {}
`.trim();
      const bp = parser.parseModel(writeYaml(POST_WITH_ENUM));
      const existingSchema = `
enum PostStatus {
  DRAFT
  PUBLISHED
}
`;
      const out = gen.generate(bp, { existingSchema });
      // Model block is emitted (no existing `model Post`)
      expect(out).toContain('model Post {');
      // Enum already exists → NOT re-emitted
      expect(out).not.toContain('enum PostStatus {');
    });
  });

  // ----------------------------------------------------------------
  // foreignId columns get @relation blocks
  // ----------------------------------------------------------------
  describe('foreignId columns emit proper @relation', () => {
    const TASK_YAML = `
model: Task
options: { belongs_to_organization: false }
columns:
  projectId:
    type: foreignId
    foreign_model: Project
  assignedTo:
    type: foreignId
    foreign_model: User
    nullable: true
relationships: []
permissions: {}
`.trim();

    it('emits the FK column immediately followed by a @relation field', () => {
      const bp = parser.parseModel(writeYaml(TASK_YAML));
      const out = gen.generate(bp);
      // projectId  Int
      // project    Project @relation(fields: [projectId], references: [id])
      expect(out).toMatch(/projectId\s+Int\b/);
      expect(out).toMatch(/project\s+Project\s+@relation\(fields:\s*\[projectId\],\s*references:\s*\[id\]\)/);
    });

    it('emits nullable relation reference for nullable FK columns', () => {
      const bp = parser.parseModel(writeYaml(TASK_YAML));
      const out = gen.generate(bp);
      // assignedTo Int?
      // assignedT  User? @relation(fields: [assignedTo], references: [id])
      expect(out).toMatch(/assignedTo\s+Int\?/);
      expect(out).toMatch(
        /assignedTo?\s+User\?\s+@relation\(fields:\s*\[assignedTo\],\s*references:\s*\[id\]\)/,
      );
    });

    it('never emits bare FK column without a relation for foreignId+foreign_model', () => {
      const bp = parser.parseModel(writeYaml(TASK_YAML));
      const out = gen.generate(bp);
      // Count the number of @relation occurrences: one per foreignId column
      // (organizationId doesn't apply here — belongs_to_organization: false)
      const matches = out.match(/@relation\(/g) ?? [];
      expect(matches.length).toBe(2); // projectId + assignedTo
    });

    it('does NOT duplicate the relation when both `foreign_model` and `relationships: belongsTo` are declared', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns:
  projectId:
    type: foreignId
    foreign_model: Project
relationships:
  - type: belongsTo
    model: Project
permissions: {}
`),
      );
      const out = gen.generate(bp);
      const relationMatches = out.match(/@relation\(/g) ?? [];
      expect(relationMatches.length).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // Decimal provider-awareness
  // ----------------------------------------------------------------
  describe('decimal type maps to Float on SQLite, Decimal elsewhere', () => {
    const MONEY_YAML = `
model: Invoice
options: {}
columns:
  amount:
    type: decimal
relationships: []
permissions: {}
`.trim();

    it('emits `Float` for decimal on SQLite', () => {
      const bp = parser.parseModel(writeYaml(MONEY_YAML));
      const out = gen.generate(bp, { provider: 'sqlite' });
      expect(out).toMatch(/amount\s+Float\b/);
      expect(out).not.toMatch(/amount\s+Decimal/);
    });

    it('emits `Decimal` for decimal on PostgreSQL', () => {
      const bp = parser.parseModel(writeYaml(MONEY_YAML));
      const out = gen.generate(bp, { provider: 'postgresql' });
      expect(out).toMatch(/amount\s+Decimal\b/);
    });

    it('defaults to PostgreSQL when no provider passed', () => {
      const bp = parser.parseModel(writeYaml(MONEY_YAML));
      const out = gen.generate(bp);
      expect(out).toMatch(/amount\s+Decimal\b/);
    });

    it('nullable decimal honors both nullable + provider mapping', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Invoice
options: {}
columns:
  amount:
    type: decimal
    nullable: true
relationships: []
permissions: {}
`),
      );
      const sqlite = gen.generate(bp, { provider: 'sqlite' });
      expect(sqlite).toMatch(/amount\s+Float\?/);
      const pg = gen.generate(bp, { provider: 'postgresql' });
      expect(pg).toMatch(/amount\s+Decimal\?/);
    });
  });

  // ----------------------------------------------------------------
  // Generator output is valid Prisma structure (structural sanity)
  // ----------------------------------------------------------------
  describe('structural sanity', () => {
    it('the generated model has @@map at the end', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Post
options: {}
columns:
  title:
    type: string
relationships: []
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toMatch(/@@map\("posts"\)\s*\}$/m);
    });

    it('UUID + belongs_to_organization + foreignId produces a cohesive block', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Comment
options:
  has_uuid: true
  belongs_to_organization: false
columns:
  body:
    type: text
  taskId:
    type: foreignId
    foreign_model: Task
relationships: []
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
      expect(out).toMatch(/taskId\s+Int/);
      expect(out).toMatch(/task\s+Task\s+@relation\(fields:\s*\[taskId\],\s*references:\s*\[id\]\)/);
    });

    it('soft_deletes: true adds deletedAt DateTime?', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Post
options:
  soft_deletes: true
columns: {}
relationships: []
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toMatch(/deletedAt\s+DateTime\?/);
    });
  });

  // ----------------------------------------------------------------
  // detectPrismaProvider (from blueprint-runner)
  // ----------------------------------------------------------------
  describe('detectPrismaProvider', () => {
    it('detects sqlite', () => {
      expect(
        detectPrismaProvider(
          'datasource db { provider = "sqlite"; url = env("DATABASE_URL") }',
        ),
      ).toBe('sqlite');
    });

    it('detects postgresql', () => {
      expect(
        detectPrismaProvider('datasource db { provider = "postgresql" }'),
      ).toBe('postgresql');
    });

    it('defaults to postgresql when no datasource found', () => {
      expect(detectPrismaProvider('')).toBe('postgresql');
      expect(detectPrismaProvider('generator client { provider = "prisma-client-js" }')).toBe(
        'postgresql',
      );
    });

    it('defaults to postgresql on unknown provider strings', () => {
      expect(detectPrismaProvider('datasource db { provider = "weirddb" }')).toBe('postgresql');
    });

    it('handles multiline datasource blocks', () => {
      expect(
        detectPrismaProvider(`
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
`),
      ).toBe('mysql');
    });
  });
});
