import { BlueprintValidator } from './blueprint-validator';
import type { Blueprint } from './blueprint-parser';

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
    permissions: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BlueprintValidator
// ---------------------------------------------------------------------------

describe('BlueprintValidator', () => {
  const validator = new BlueprintValidator();

  it('passes a valid minimal blueprint', () => {
    const result = validator.validate(makeBlueprint());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes a full blueprint with columns, permissions, relationships', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'title',
          type: 'string',
          nullable: false,
          unique: false,
          index: false,
          default: null,
          filterable: true,
          sortable: true,
          searchable: true,
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
      relationships: [{ name: 'user', type: 'belongsTo', model: 'User' }],
      permissions: {
        admin: {
          actions: ['index', 'show', 'store', 'update', 'destroy'],
          show_fields: ['*'],
          create_fields: { title: 'required', status: 'nullable' },
          update_fields: { title: 'sometimes' },
          hidden_fields: [],
        },
        viewer: {
          actions: ['index', 'show'],
          show_fields: ['id', 'title'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(true);
  });

  // ---- model name ---------------------------------------------------------

  it('errors on empty model name', () => {
    const result = validator.validate(makeBlueprint({ model: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Model name is required.');
  });

  it('errors on non-PascalCase model name', () => {
    const result = validator.validate(makeBlueprint({ model: 'blog_post' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('PascalCase'))).toBe(true);
  });

  it('errors on snake_case slug with spaces', () => {
    const result = validator.validate(makeBlueprint({ slug: 'my posts' }));
    expect(result.valid).toBe(false);
  });

  // ---- columns ------------------------------------------------------------

  it('errors on invalid column type', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'foo',
          type: 'mongo_id',
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
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('mongo_id'))).toBe(true);
  });

  it('errors on duplicate column name', () => {
    const col = {
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
    };
    const bp = makeBlueprint({ columns: [col, { ...col }] });
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('errors on foreignId column missing foreign_model', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'user_id',
          type: 'foreignId',
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
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('foreign_model'))).toBe(true);
  });

  it('errors on enum column missing values', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'status',
          type: 'enum',
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
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('values'))).toBe(true);
  });

  // ---- permissions --------------------------------------------------------

  it('errors on invalid action in permissions', () => {
    const bp = makeBlueprint({
      permissions: {
        admin: {
          actions: ['read'], // invalid
          show_fields: ['*'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("'read'"))).toBe(true);
  });

  it('errors on unknown role when validRoles provided', () => {
    const bp = makeBlueprint({
      permissions: {
        superadmin: {
          actions: ['index'],
          show_fields: ['*'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const result = validator.validate(bp, ['admin', 'viewer']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("'superadmin'"))).toBe(true);
  });

  it('does NOT error on unknown role when validRoles empty', () => {
    const bp = makeBlueprint({
      permissions: {
        custom_role: {
          actions: ['index'],
          show_fields: ['*'],
          create_fields: {},
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const result = validator.validate(bp, []);
    expect(result.valid).toBe(true);
  });

  it('warns when field in both show_fields and hidden_fields', () => {
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
      permissions: {
        viewer: {
          actions: ['index', 'show'],
          show_fields: ['id', 'title'],
          create_fields: {},
          update_fields: {},
          hidden_fields: ['title'],
        },
      },
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(true); // warnings, not errors
    expect(result.warnings.some((w) => w.includes('title'))).toBe(true);
  });

  it('warns when create_fields given but no store action', () => {
    const bp = makeBlueprint({
      permissions: {
        viewer: {
          actions: ['index', 'show'],
          show_fields: ['*'],
          create_fields: { title: 'required' },
          update_fields: {},
          hidden_fields: [],
        },
      },
    });
    const result = validator.validate(bp);
    expect(result.warnings.some((w) => w.includes('store'))).toBe(true);
  });

  // ---- relationships ------------------------------------------------------

  it('errors on invalid relationship type', () => {
    const bp = makeBlueprint({
      relationships: [{ name: 'foo', type: 'manyToMany', model: 'Bar' }],
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('manyToMany'))).toBe(true);
  });

  it('errors on relationship missing model', () => {
    const bp = makeBlueprint({
      relationships: [{ name: 'user', type: 'belongsTo', model: '' }],
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing model"))).toBe(true);
  });

  // ---- options ------------------------------------------------------------

  it('errors on invalid except_action', () => {
    const bp = makeBlueprint({
      options: {
        belongs_to_organization: false,
        soft_deletes: false,
        audit_trail: false,
      has_uuid: false,
        owner: null,
      owner_chain: null,
        except_actions: ['fetch'], // invalid
        pagination: false,
        per_page: 25,
      },
    });
    const result = validator.validate(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("'fetch'"))).toBe(true);
  });
});
