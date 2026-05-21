import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { BlueprintRunner } from '../../src/blueprint/blueprint-runner';

/**
 * End-to-end acid test for the blueprint generators.
 *
 * Process:
 *   1. Write a real post.yaml fixture to a temp project tree.
 *   2. Run the BlueprintRunner (same code path as `npx rhino blueprint`).
 *   3. Parse every generated .ts file with the TypeScript compiler and
 *      assert it has ZERO syntax errors.
 *
 * This catches the class of bug where generators emit code that passes
 * string-contains unit assertions but is not actually valid TypeScript.
 */
function mkTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-blueprint-e2e-'));
  fs.mkdirSync(path.join(dir, '.rhino', 'blueprints'), { recursive: true });
  return dir;
}

const POST_YAML = `
model: Post
slug: posts
table: posts
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
  content:
    type: text
  status:
    type: enum
    values: [draft, published]
relationships:
  user:
    type: belongsTo
    model: User
permissions:
  admin:
    actions: ["*"]
    show_fields: "*"
    create_fields: { title: required, content: nullable, status: nullable }
    update_fields: { title: sometimes, content: nullable, status: nullable }
  viewer:
    actions: [index, show]
    show_fields: [id, title, content, status]
    create_fields: {}
    update_fields: {}
    hidden_fields: []
`;

function parseTsFile(file: string): ts.Diagnostic[] {
  const content = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics: ts.Diagnostic[] = [];
  // parseDiagnostics is private in typings but present at runtime; cast to get syntax errors
  const rawDiag = (source as any).parseDiagnostics ?? [];
  for (const d of rawDiag) diagnostics.push(d);
  return diagnostics;
}

describe('Blueprint end-to-end (generate → syntactically valid TS)', () => {
  let project: string;

  beforeEach(() => {
    project = mkTempProject();
    fs.writeFileSync(path.join(project, '.rhino', 'blueprints', 'post.yaml'), POST_YAML);
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('writes all 5 artifact types', async () => {
    const runner = new BlueprintRunner();
    const report = await runner.run({ projectRoot: project, silent: true });
    expect(report.processed).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
    expect(fs.existsSync(path.join(project, 'prisma', 'schema.prisma'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'src', 'resources', 'PostResource.ts'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'src', 'policies', 'PostPolicy.ts'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'src', 'seeders', 'PostSeeder.ts'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'test', 'generated', 'Post.spec.ts'))).toBe(true);
  });

  it('PostResource.ts parses without syntax errors', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const file = path.join(project, 'src', 'resources', 'PostResource.ts');
    const diagnostics = parseTsFile(file);
    if (diagnostics.length > 0) {
      const messages = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      );
      throw new Error(`Syntax errors in ${file}:\n${messages.join('\n')}\n\nFile contents:\n${fs.readFileSync(file, 'utf8')}`);
    }
    expect(diagnostics).toHaveLength(0);
  });

  it('PostPolicy.ts parses without syntax errors', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const diagnostics = parseTsFile(path.join(project, 'src', 'policies', 'PostPolicy.ts'));
    expect(diagnostics).toHaveLength(0);
  });

  it('Post.spec.ts parses without syntax errors', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const diagnostics = parseTsFile(path.join(project, 'test', 'generated', 'Post.spec.ts'));
    expect(diagnostics).toHaveLength(0);
  });

  it('PostSeeder.ts parses without syntax errors', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const diagnostics = parseTsFile(path.join(project, 'src', 'seeders', 'PostSeeder.ts'));
    expect(diagnostics).toHaveLength(0);
  });

  it('generated PostResource defines Zod schemas for both admin and viewer roles', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const content = fs.readFileSync(
      path.join(project, 'src', 'resources', 'PostResource.ts'),
      'utf8',
    );
    // Admin has explicit create/update fields
    expect(content).toMatch(/admin:\s*z\.object\({/);
    // Viewer has empty {} create/update — must emit valid `z.object({})`
    expect(content).toMatch(/viewer:\s*z\.object\({\s*}\)/);
    // And crucially: no bare commas inside empty objects
    expect(content).not.toMatch(/z\.object\({\s*,/);
  });

  it('generated Post.spec uses real GlobalController signatures', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const content = fs.readFileSync(
      path.join(project, 'test', 'generated', 'Post.spec.ts'),
      'utf8',
    );
    expect(content).toContain(".index('posts', {}, req)");
    expect(content).toContain(".store('posts', body, req)");
    expect(content).toContain(".destroy('posts', '1', req)");
    // Must NOT use the old single-arg shape
    expect(content).not.toMatch(/\.index\(req\)/);
    expect(content).not.toMatch(/\.show\(req\)/);
    expect(content).not.toMatch(/\.store\(req\)/);
  });

  it('generated Post.spec uses correct user shape (userRoles not roles)', async () => {
    await new BlueprintRunner().run({ projectRoot: project, silent: true });
    const content = fs.readFileSync(
      path.join(project, 'test', 'generated', 'Post.spec.ts'),
      'utf8',
    );
    expect(content).toContain('userRoles:');
    expect(content).not.toMatch(/^\s*roles:\s*\[/m);
  });

  it('re-running skips unchanged blueprints via manifest', async () => {
    const runner = new BlueprintRunner();
    const first = await runner.run({ projectRoot: project, silent: true });
    expect(first.processed).toHaveLength(1);
    const second = await runner.run({ projectRoot: project, silent: true });
    expect(second.skipped).toHaveLength(1);
    expect(second.processed).toHaveLength(0);
  });

  it('--force re-generates even when unchanged', async () => {
    const runner = new BlueprintRunner();
    await runner.run({ projectRoot: project, silent: true });
    const report = await runner.run({ projectRoot: project, silent: true, force: true });
    expect(report.processed).toHaveLength(1);
  });
});
