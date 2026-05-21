/**
 * BP-005 — end-to-end tests covering the `has_uuid: true` option across the
 * blueprint pipeline: parser → prisma schema generator → resource definition
 * generator → seeder → test generator.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { BlueprintParser } from '../blueprint-parser';
import { PrismaSchemaGenerator } from './prisma-schema-generator';
import { ResourceDefinitionGenerator } from './resource-definition-generator';
import { SeederGenerator } from './seeder-generator';
import { TestGenerator } from './test-generator';

const COMMENT_UUID_YAML = `
model: Comment
slug: comments
table: comments
options:
  belongs_to_organization: false
  soft_deletes: true
  audit_trail: false
  has_uuid: true
columns:
  body:
    type: text
    nullable: false
  taskId:
    type: foreignId
    foreign_model: Task
relationships: []
permissions:
  admin:
    actions: ["*"]
    show_fields: "*"
    create_fields: { body: required, taskId: required }
    update_fields: { body: sometimes }
`.trim();

const POST_INT_YAML = `
model: Post
slug: posts
table: posts
options:
  belongs_to_organization: false
  soft_deletes: true
  audit_trail: false
columns:
  title:
    type: string
    nullable: false
relationships: []
permissions:
  admin:
    actions: ["*"]
    show_fields: "*"
    create_fields: { title: required }
    update_fields: { title: sometimes }
`.trim();

function writeYaml(content: string, filename = 'bp.yaml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'has-uuid-'));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function parseTsSyntax(source: string): ts.Diagnostic[] {
  const s = ts.createSourceFile('x.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return ((s as any).parseDiagnostics ?? []) as ts.Diagnostic[];
}

describe('BP-005: has_uuid: true propagates through every generator', () => {
  const parser = new BlueprintParser();

  it('parser exposes options.has_uuid', () => {
    const blueprint = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'comment.yaml'));
    expect(blueprint.options.has_uuid).toBe(true);
  });

  it('parser defaults has_uuid to false when omitted', () => {
    const blueprint = parser.parseModel(writeYaml(POST_INT_YAML, 'post.yaml'));
    expect(blueprint.options.has_uuid).toBe(false);
  });

  describe('PrismaSchemaGenerator', () => {
    it('emits `String @id @default(uuid())` when has_uuid is true', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new PrismaSchemaGenerator().generate(bp);
      expect(out).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
      expect(out).not.toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
    });

    it('emits `Int @id @default(autoincrement())` when has_uuid is absent', () => {
      const bp = parser.parseModel(writeYaml(POST_INT_YAML, 'p.yaml'));
      const out = new PrismaSchemaGenerator().generate(bp);
      expect(out).toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
      expect(out).not.toMatch(/String\s+@id\s+@default\(uuid\(\)\)/);
    });
  });

  describe('ResourceDefinitionGenerator', () => {
    it('emits `hasUuid: true` on ModelRegistration when has_uuid', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new ResourceDefinitionGenerator().generate(bp);
      expect(out).toContain('hasUuid: true,');
    });

    it('omits the hasUuid flag when has_uuid is false (avoid noise)', () => {
      const bp = parser.parseModel(writeYaml(POST_INT_YAML, 'p.yaml'));
      const out = new ResourceDefinitionGenerator().generate(bp);
      expect(out).not.toContain('hasUuid');
    });

    it('generated file is syntactically valid TypeScript', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new ResourceDefinitionGenerator().generate(bp);
      expect(parseTsSyntax(out)).toHaveLength(0);
    });
  });

  describe('SeederGenerator', () => {
    it('uses string UUIDs in `where: { id: "..." }` for UUID-PK models', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new SeederGenerator().generate(bp);
      // Expect strings like 00000000-0000-0000-0000-000000000001
      expect(out).toMatch(/where:\s*\{\s*id:\s*'00000000-0000-0000-0000-\d{12}'\s*\}/);
      expect(out).not.toMatch(/where:\s*\{\s*id:\s*\d+\s*\}/);
    });

    it('still uses integer ids for non-UUID models', () => {
      const bp = parser.parseModel(writeYaml(POST_INT_YAML, 'p.yaml'));
      const out = new SeederGenerator().generate(bp);
      expect(out).toMatch(/where:\s*\{\s*id:\s*1\s*\}/);
      expect(out).not.toMatch(/where:\s*\{\s*id:\s*'00000000/);
    });

    it('create block has matching UUID id when has_uuid', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new SeederGenerator().generate(bp);
      // Each upsert create must carry the same UUID as its where clause
      expect(out).toMatch(/id:\s*"00000000-0000-0000-0000-000000000001"/);
      expect(out).toMatch(/id:\s*"00000000-0000-0000-0000-000000000002"/);
      expect(out).toMatch(/id:\s*"00000000-0000-0000-0000-000000000003"/);
    });

    it('seeder file is syntactically valid TypeScript', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new SeederGenerator().generate(bp);
      expect(parseTsSyntax(out)).toHaveLength(0);
    });
  });

  describe('TestGenerator', () => {
    it('generated tests pass string UUIDs to controller.show/update/destroy for UUID models', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new TestGenerator().generate(bp);

      // The generated test should use string UUID literals, not '1'
      expect(out).toContain(".show('comments', '00000000-0000-0000-0000-000000000001', {}, req)");
      expect(out).toContain(".update('comments', '00000000-0000-0000-0000-000000000001', body, req)");
      expect(out).toContain(".destroy('comments', '00000000-0000-0000-0000-000000000001', req)");
      // And not the integer shape
      expect(out).not.toContain(".show('comments', '1', {}, req)");
    });

    it('generated sampleRow has a UUID id', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new TestGenerator().generate(bp);
      expect(out).toMatch(/"id":\s*"00000000-0000-0000-0000-000000000001"/);
    });

    it('integer-PK tests unchanged (backwards compat)', () => {
      const bp = parser.parseModel(writeYaml(POST_INT_YAML, 'p.yaml'));
      const out = new TestGenerator().generate(bp);
      expect(out).toContain(".show('posts', '1', {}, req)");
      expect(out).not.toContain('00000000-0000-0000-0000-');
    });

    it('generated spec file is syntactically valid TypeScript', () => {
      const bp = parser.parseModel(writeYaml(COMMENT_UUID_YAML, 'c.yaml'));
      const out = new TestGenerator().generate(bp);
      expect(parseTsSyntax(out)).toHaveLength(0);
    });
  });
});
