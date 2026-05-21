import { SeederGenerator } from './seeder-generator';
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
      belongs_to_organization: true,
      soft_deletes: true,
      audit_trail: false,
      has_uuid: false,
      owner: null,
      owner_chain: null,
      except_actions: [],
      pagination: false,
      per_page: 25,
    },
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
      {
        name: 'content',
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
    relationships: [],
    permissions: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SeederGenerator
// ---------------------------------------------------------------------------

describe('SeederGenerator', () => {
  const gen = new SeederGenerator();

  it('generates a TypeScript file with PrismaClient import', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("import { PrismaClient } from '@prisma/client'");
  });

  it('exports an async seed function', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('export async function seed()');
  });

  it('includes upsert calls for 3 sample rows', () => {
    const output = gen.generate(makeBlueprint());
    const upsertCount = (output.match(/\.upsert\(/g) ?? []).length;
    expect(upsertCount).toBe(3);
  });

  it('uses the correct Prisma model name (camelCase)', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('prisma.post.upsert');
  });

  it('includes organizationId when belongs_to_organization is true', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('organizationId');
  });

  it('does NOT include organizationId when belongs_to_organization is false', () => {
    const bp = makeBlueprint({
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
    });
    const output = gen.generate(bp);
    expect(output).not.toContain('organizationId');
  });

  it('generates sample text for string columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toMatch(/Sample Title/i);
  });

  it('uses enum first value for enum columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('"draft"');
  });

  it('uses column default value when available', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'active',
          type: 'boolean',
          nullable: false,
          unique: false,
          index: false,
          default: false,
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
    // The formatObject helper produces "active: false" (key unquoted, value JSON-serialised)
    expect(output).toContain('active: false');
  });

  it('includes a standalone runner block', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('require.main === module');
  });

  it('includes a console.log completion message', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('seeded');
  });

  it('generates different index values for the 3 rows (id 1, 2, 3)', () => {
    const output = gen.generate(makeBlueprint());
    // formatObject produces "id: 1" (key unquoted, value JSON.stringify'd)
    expect(output).toContain('id: 1');
    expect(output).toContain('id: 2');
    expect(output).toContain('id: 3');
  });
});
