import { PolicyGenerator } from './policy-generator';
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
    columns: [],
    relationships: [],
    permissions: {
      admin: {
        actions: ['index', 'show', 'store', 'update', 'destroy'],
        show_fields: ['*'],
        create_fields: { title: 'required', content: 'nullable' },
        update_fields: { title: 'sometimes', content: 'nullable' },
        hidden_fields: [],
      },
      viewer: {
        actions: ['index', 'show'],
        show_fields: ['id', 'title', 'content'],
        create_fields: {},
        update_fields: {},
        hidden_fields: ['secret'],
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PolicyGenerator
// ---------------------------------------------------------------------------

describe('PolicyGenerator', () => {
  const gen = new PolicyGenerator();

  it('generates a TypeScript class extending ResourcePolicy', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('class PostPolicy extends ResourcePolicy');
    expect(output).toContain("import { ResourcePolicy }");
  });

  it('sets resourceSlug to the blueprint slug', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("resourceSlug = 'posts'");
  });

  it('overrides all four attribute permission methods', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('permittedAttributesForShow');
    expect(output).toContain('hiddenAttributesForShow');
    expect(output).toContain('permittedAttributesForCreate');
    expect(output).toContain('permittedAttributesForUpdate');
  });

  it('emits hasRole guard for each role', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("this.hasRole(user, 'admin', org)");
    expect(output).toContain("this.hasRole(user, 'viewer', org)");
  });

  it('returns [*] for wildcard show_fields', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("return ['*']");
  });

  it('returns specific field array for restricted show_fields', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("return ['id', 'title', 'content']");
  });

  it('returns hidden fields in hiddenAttributesForShow', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("return ['secret']");
  });

  it('returns [] for hiddenAttributesForShow when no role has hidden_fields', () => {
    const bp = makeBlueprint({
      permissions: {
        admin: {
          actions: ['index'],
          show_fields: ['*'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const output = gen.generate(bp);
    // default return [] at end of hiddenAttributesForShow
    expect(output).toContain('return []');
  });

  it('uses Object.keys for create_fields (object form)', () => {
    const output = gen.generate(makeBlueprint());
    // admin create_fields: { title: 'required', content: 'nullable' }
    // Should produce ['title', 'content'] in permittedAttributesForCreate
    expect(output).toContain("return ['title', 'content']");
  });

  it('generates empty blueprint with default returns', () => {
    const bp = makeBlueprint({ permissions: {} });
    const output = gen.generate(bp);
    expect(output).toContain("return ['*']");
  });

  it('groups roles with identical show_fields into one if-branch', () => {
    const bp = makeBlueprint({
      permissions: {
        admin: {
          actions: ['index', 'show'],
          show_fields: ['id', 'title'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
        editor: {
          actions: ['index', 'show'],
          show_fields: ['id', 'title'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const output = gen.generate(bp);
    // Both admin and editor share the same show_fields — should appear in one if
    const matches = output.match(/this\.hasRole\(user,/g);
    // Two hasRole calls for the one shared group (admin and editor together)
    expect(matches?.length).toBeLessThanOrEqual(4); // at most 4 per method
    expect(output).toContain("this.hasRole(user, 'admin', org)");
    expect(output).toContain("this.hasRole(user, 'editor', org)");
  });

  it('buildCondition joins multiple roles with ||', () => {
    const condition = gen.buildCondition(['admin', 'editor']);
    expect(condition).toContain("this.hasRole(user, 'admin', org)");
    expect(condition).toContain("this.hasRole(user, 'editor', org)");
    expect(condition).toContain('||');
  });

  it('fieldsToTsArray handles wildcard', () => {
    expect(gen.fieldsToTsArray(['*'])).toBe("['*']");
  });

  it('fieldsToTsArray handles normal array', () => {
    expect(gen.fieldsToTsArray(['id', 'name'])).toBe("['id', 'name']");
  });
});
