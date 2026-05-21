import { PrismaSchemaGenerator } from './prisma-schema-generator';
import type { Blueprint } from '../blueprint-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    model: 'Post',
    slug: 'posts',
    table: 'posts',
    source_file: 'post.yaml',
    options: {
      belongs_to_organization: false,
      soft_deletes: false,
      audit_trail: false,
      has_uuid: false,
      owner: null,
      owner_chain: null,
      except_actions: [],
      pagination: false,
      per_page: 25,
    },
    columns: [],
    relationships: [],
    permissions: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrismaSchemaGenerator
// ---------------------------------------------------------------------------

describe('PrismaSchemaGenerator', () => {
  const gen = new PrismaSchemaGenerator();

  it('generates a model block with id, timestamps, and @@map', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('model Post {');
    expect(output).toContain('@id @default(autoincrement())');
    expect(output).toContain('createdAt');
    expect(output).toContain('updatedAt');
    expect(output).toContain('@@map("posts")');
  });

  it('adds deletedAt when soft_deletes is true', () => {
    const output = gen.generate(makeBlueprint({ options: { ...makeBlueprint().options, soft_deletes: true } }));
    expect(output).toContain('deletedAt');
    expect(output).toContain('DateTime?');
  });

  it('does NOT add deletedAt when soft_deletes is false', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).not.toContain('deletedAt');
  });

  it('adds organizationId FK when belongs_to_organization', () => {
    const output = gen.generate(
      makeBlueprint({ options: { ...makeBlueprint().options, belongs_to_organization: true } }),
    );
    expect(output).toContain('organizationId');
    expect(output).toContain('Organization @relation');
  });

  it('maps string columns to String', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'title',
          type: 'string',
          nullable: false,
          unique: false,
          index: false,
          default: null,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toMatch(/title\s+String/);
  });

  it('maps integer to Int', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'count',
          type: 'integer',
          nullable: false,
          unique: false,
          index: false,
          default: null,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toMatch(/count\s+Int/);
  });

  it('adds ? to type for nullable columns', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'bio',
          type: 'text',
          nullable: true,
          unique: false,
          index: false,
          default: null,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toContain('String?');
  });

  it('adds @unique for unique columns', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'email',
          type: 'string',
          nullable: false,
          unique: true,
          index: false,
          default: null,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toContain('@unique');
  });

  it('generates enum declaration for enum columns', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'status',
          type: 'enum',
          values: ['draft', 'published'],
          nullable: false,
          unique: false,
          index: false,
          default: null,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toContain('enum PostStatus {');
    expect(output).toContain('DRAFT');
    expect(output).toContain('PUBLISHED');
    expect(output).toMatch(/status\s+PostStatus/);
  });

  it('generates belongsTo relationship fields', () => {
    const bp = makeBlueprint({
      relationships: [{ name: 'user', type: 'belongsTo', model: 'User' }],
    });
    const output = gen.generate(bp);
    expect(output).toContain('userId');
    expect(output).toContain('User @relation');
  });

  it('generates hasMany relationship array field', () => {
    const bp = makeBlueprint({
      relationships: [{ name: 'comments', type: 'hasMany', model: 'Comment' }],
    });
    const output = gen.generate(bp);
    expect(output).toContain('Comment[]');
  });

  it('adds @default for columns with default value', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'active',
          type: 'boolean',
          nullable: false,
          unique: false,
          index: false,
          default: true,
          filterable: false,
          sortable: false,
          searchable: false,
          precision: null,
          scale: null,
          foreignModel: null,
        },
      ],
    });
    const output = gen.generate(bp);
    expect(output).toContain('@default(true)');
  });
});
