import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlueprintRunner } from './blueprint-runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal project directory structure for runner tests.
 * Returns the projectRoot path.
 */
function makeProject(blueprints: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
  const blueprintsDir = path.join(root, '.rhino', 'blueprints');
  fs.mkdirSync(blueprintsDir, { recursive: true });

  for (const [filename, content] of Object.entries(blueprints)) {
    fs.writeFileSync(path.join(blueprintsDir, filename), content, 'utf8');
  }

  return root;
}

const VALID_POST_YAML = `
model: Post
slug: posts
table: posts
options:
  belongs_to_organization: true
  soft_deletes: true
  audit_trail: false
columns:
  title:
    type: string
    filterable: true
    sortable: true
    searchable: true
  content:
    type: text
relationships: {}
permissions:
  admin:
    actions: ["*"]
    show_fields: "*"
    create_fields: { title: required }
    update_fields: { title: sometimes }
  viewer:
    actions: [index, show]
    show_fields: [id, title]
    hidden_fields: []
`.trim();

const VALID_ARTICLE_YAML = `
model: Article
slug: articles
table: articles
options:
  belongs_to_organization: false
  soft_deletes: false
  audit_trail: false
columns:
  title:
    type: string
relationships: {}
permissions:
  editor:
    actions: [index, show, store, update, destroy]
    show_fields: "*"
    create_fields: { title: required }
    update_fields: { title: sometimes }
`.trim();

const INVALID_YAML = `model: 123_invalid`;

// ---------------------------------------------------------------------------
// BlueprintRunner
// ---------------------------------------------------------------------------

describe('BlueprintRunner', () => {
  const runner = new BlueprintRunner();

  it('returns empty result when blueprints directory does not exist', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-empty-'));
    const result = await runner.run({ projectRoot: root, silent: true });
    expect(result.processed).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('processes a valid blueprint and writes all 5 output files', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });
    const result = await runner.run({ projectRoot: root, silent: true });

    expect(result.processed).toContain('post.yaml');
    expect(result.errors).toHaveLength(0);
    expect(result.generatedFiles).toHaveLength(5);

    // Verify files were actually written
    expect(fs.existsSync(path.join(root, 'src', 'policies', 'PostPolicy.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'resources', 'PostResource.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'seeders', 'PostSeeder.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test', 'generated', 'Post.spec.ts'))).toBe(true);
    // Prisma schema appended
    expect(fs.existsSync(path.join(root, 'prisma', 'schema.prisma'))).toBe(true);
  });

  it('skips unchanged blueprints on second run', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });

    // First run
    const r1 = await runner.run({ projectRoot: root, silent: true });
    expect(r1.processed).toContain('post.yaml');
    expect(r1.skipped).not.toContain('post.yaml');

    // Second run — same file
    const r2 = await runner.run({ projectRoot: root, silent: true });
    expect(r2.processed).not.toContain('post.yaml');
    expect(r2.skipped).toContain('post.yaml');
  });

  it('re-processes blueprints with --force flag', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });

    await runner.run({ projectRoot: root, silent: true });
    const r2 = await runner.run({ projectRoot: root, silent: true, force: true });

    expect(r2.processed).toContain('post.yaml');
    expect(r2.skipped).not.toContain('post.yaml');
  });

  it('re-processes when blueprint file content changes', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });

    await runner.run({ projectRoot: root, silent: true });

    // Modify the blueprint
    const blueprintPath = path.join(root, '.rhino', 'blueprints', 'post.yaml');
    fs.appendFileSync(blueprintPath, '\n# modified');

    const r2 = await runner.run({ projectRoot: root, silent: true });
    expect(r2.processed).toContain('post.yaml');
  });

  it('--dry-run does not write files', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });
    const result = await runner.run({ projectRoot: root, silent: true, dryRun: true });

    expect(result.processed).toContain('post.yaml');
    expect(result.generatedFiles).toHaveLength(5);
    // Files should NOT be written
    expect(fs.existsSync(path.join(root, 'src', 'policies', 'PostPolicy.ts'))).toBe(false);
    // Manifest should NOT be saved
    expect(fs.existsSync(path.join(root, '.rhino', 'manifest.json'))).toBe(false);
  });

  it('--model flag filters to a specific blueprint', async () => {
    const root = makeProject({
      'post.yaml': VALID_POST_YAML,
      'article.yaml': VALID_ARTICLE_YAML,
    });

    const result = await runner.run({ projectRoot: root, silent: true, model: 'Post' });

    expect(result.processed).toContain('post.yaml');
    expect(result.skipped).toContain('article.yaml');
    expect(fs.existsSync(path.join(root, 'src', 'policies', 'PostPolicy.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'policies', 'ArticlePolicy.ts'))).toBe(false);
  });

  it('--model flag is case-insensitive', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });
    const result = await runner.run({ projectRoot: root, silent: true, model: 'post' });
    expect(result.processed).toContain('post.yaml');
  });

  it('records errors for invalid blueprints without stopping other processing', async () => {
    const root = makeProject({
      'bad.yaml': INVALID_YAML,
      'article.yaml': VALID_ARTICLE_YAML,
    });

    const result = await runner.run({ projectRoot: root, silent: true });

    expect(result.errors.some((e) => e.file === 'bad.yaml')).toBe(true);
    expect(result.processed).toContain('article.yaml');
  });

  it('processes multiple blueprints in alphabetical order', async () => {
    const root = makeProject({
      'post.yaml': VALID_POST_YAML,
      'article.yaml': VALID_ARTICLE_YAML,
    });

    const result = await runner.run({ projectRoot: root, silent: true });
    expect(result.processed).toContain('post.yaml');
    expect(result.processed).toContain('article.yaml');
    expect(result.generatedFiles).toHaveLength(10); // 5 per blueprint
  });

  it('saves the manifest after processing', async () => {
    const root = makeProject({ 'post.yaml': VALID_POST_YAML });
    await runner.run({ projectRoot: root, silent: true });
    const manifestPath = path.join(root, '.rhino', 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.files['post.yaml']).toBeDefined();
  });

  // --------------------------------------------------------------------
  // BP-009: skip leading-underscore files (shared anchors / partials)
  // --------------------------------------------------------------------
  describe('BP-009: _*.yaml files are skipped (not errored)', () => {
    const SHARED_ROLES_YAML = `
owner:
  actions: ["*"]
  show_fields: "*"
admin:
  actions: [index, show, store]
`.trim();

    it('silently skips _roles.yaml (no model key) without reporting an error', async () => {
      const root = makeProject({
        '_roles.yaml': SHARED_ROLES_YAML,
        'post.yaml': VALID_POST_YAML,
      });
      const result = await runner.run({ projectRoot: root, silent: true });

      expect(result.errors).toHaveLength(0);
      expect(result.processed).toEqual(['post.yaml']);
      // _roles.yaml should never show up in any result bucket
      expect(result.processed).not.toContain('_roles.yaml');
      expect(result.skipped).not.toContain('_roles.yaml');
    });

    it('skips every file that starts with underscore regardless of content', async () => {
      const root = makeProject({
        '_shared.yaml': 'anything: goes here',
        '_common.yaml': SHARED_ROLES_YAML,
        '_base.yml': 'foo: bar',
        'post.yaml': VALID_POST_YAML,
        'article.yaml': VALID_ARTICLE_YAML,
      });
      const result = await runner.run({ projectRoot: root, silent: true });

      expect(result.errors).toHaveLength(0);
      expect(result.processed.sort()).toEqual(['article.yaml', 'post.yaml']);
    });

    it('returns empty when directory has only _*.yaml files', async () => {
      const root = makeProject({ '_roles.yaml': SHARED_ROLES_YAML });
      const result = await runner.run({ projectRoot: root, silent: true });
      expect(result.errors).toHaveLength(0);
      expect(result.processed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('still applies --model filter alongside underscore skipping', async () => {
      const root = makeProject({
        '_roles.yaml': SHARED_ROLES_YAML,
        'post.yaml': VALID_POST_YAML,
        'article.yaml': VALID_ARTICLE_YAML,
      });
      const result = await runner.run({
        projectRoot: root,
        silent: true,
        model: 'Post',
      });
      expect(result.processed).toEqual(['post.yaml']);
      expect(result.skipped).toEqual(['article.yaml']);
    });
  });
});
