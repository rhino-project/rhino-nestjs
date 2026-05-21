import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlueprintParser } from './blueprint-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmp(content: string, ext = '.yaml'): string {
  const file = path.join(os.tmpdir(), `bp-test-${Date.now()}${ext}`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// BlueprintParser
// ---------------------------------------------------------------------------

describe('BlueprintParser', () => {
  const parser = new BlueprintParser();

  // ---- happy path ---------------------------------------------------------

  it('parses a valid blueprint YAML', () => {
    const file = writeTmp(`
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
    create_fields: { title: required, content: nullable }
    update_fields: { title: sometimes }
  viewer:
    actions: [index, show]
    show_fields: [id, title]
    hidden_fields: []
`);

    const bp = parser.parseModel(file);

    expect(bp.model).toBe('Post');
    expect(bp.slug).toBe('posts');
    expect(bp.table).toBe('posts');
    expect(bp.options.belongs_to_organization).toBe(true);
    expect(bp.options.soft_deletes).toBe(true);
    expect(bp.options.audit_trail).toBe(false);

    // Columns
    expect(bp.columns).toHaveLength(3);
    const titleCol = bp.columns.find((c) => c.name === 'title')!;
    expect(titleCol.type).toBe('string');
    expect(titleCol.filterable).toBe(true);
    expect(titleCol.sortable).toBe(true);
    expect(titleCol.searchable).toBe(true);

    const statusCol = bp.columns.find((c) => c.name === 'status')!;
    expect(statusCol.type).toBe('enum');
    expect(statusCol.values).toEqual(['draft', 'published']);

    // Relationships
    expect(bp.relationships).toHaveLength(1);
    expect(bp.relationships[0]).toMatchObject({ name: 'user', type: 'belongsTo', model: 'User' });

    // Permissions
    expect(Object.keys(bp.permissions)).toEqual(['admin', 'viewer']);
    // admin wildcard expands
    expect(bp.permissions['admin'].actions).toContain('index');
    expect(bp.permissions['admin'].actions).toContain('store');
    expect(bp.permissions['admin'].show_fields).toEqual(['*']);

    const viewer = bp.permissions['viewer'];
    expect(viewer.actions).toEqual(['index', 'show']);
    expect(viewer.show_fields).toEqual(['id', 'title']);
    expect(viewer.hidden_fields).toEqual([]);
  });

  it('infers slug from model name when not provided', () => {
    const file = writeTmp(`model: BlogPost\n`);
    const bp = parser.parseModel(file);
    expect(bp.slug).toBe('blog_posts');
  });

  it('uses short column syntax (type string)', () => {
    const file = writeTmp(`
model: Tag
columns:
  name: string
`);
    const bp = parser.parseModel(file);
    expect(bp.columns[0]).toMatchObject({ name: 'name', type: 'string' });
  });

  it('normalizes default option values', () => {
    const file = writeTmp(`model: Item\n`);
    const bp = parser.parseModel(file);
    expect(bp.options.soft_deletes).toBe(true); // default
    expect(bp.options.belongs_to_organization).toBe(false);
    expect(bp.options.per_page).toBe(25);
  });

  // ---- missing required fields --------------------------------------------

  it('throws when model key is missing', () => {
    const file = writeTmp(`slug: posts\n`);
    expect(() => parser.parseModel(file)).toThrow(/missing 'model' key/i);
  });

  it('throws when file does not exist', () => {
    expect(() => parser.parseModel('/nonexistent/path/blueprint.yaml')).toThrow(/not found/i);
  });

  it('throws on empty file', () => {
    const file = writeTmp('');
    expect(() => parser.parseModel(file)).toThrow(/empty/i);
  });

  it('throws on invalid YAML syntax', () => {
    const file = writeTmp(`model: Post\ncolumns: :\n  bad:`);
    expect(() => parser.parseModel(file)).toThrow();
  });

  it('throws when YAML is not a mapping (e.g. plain string)', () => {
    const file = writeTmp(`just a string`);
    expect(() => parser.parseModel(file)).toThrow(/associative mapping/i);
  });

  // ---- types / relationships ----------------------------------------------

  it('parses hasMany relationship', () => {
    const file = writeTmp(`
model: User
relationships:
  posts:
    type: hasMany
    model: Post
`);
    const bp = parser.parseModel(file);
    expect(bp.relationships[0]).toMatchObject({ name: 'posts', type: 'hasMany', model: 'Post' });
  });

  it('handles missing relationships section', () => {
    const file = writeTmp(`model: Product\n`);
    const bp = parser.parseModel(file);
    expect(bp.relationships).toEqual([]);
  });

  it('handles missing permissions section', () => {
    const file = writeTmp(`model: Product\n`);
    const bp = parser.parseModel(file);
    expect(bp.permissions).toEqual({});
  });

  // ---- hash ---------------------------------------------------------------

  it('computeFileHash returns a 64-char hex string', () => {
    const file = writeTmp(`model: Post\n`);
    const hash = parser.computeFileHash(file);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeFileHash changes when content changes', () => {
    const file = writeTmp(`model: Post\n`);
    const h1 = parser.computeFileHash(file);
    fs.appendFileSync(file, `# extra\n`);
    const h2 = parser.computeFileHash(file);
    expect(h1).not.toBe(h2);
  });
});
