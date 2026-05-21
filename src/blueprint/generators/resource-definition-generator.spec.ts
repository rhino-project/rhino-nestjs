import { ResourceDefinitionGenerator } from './resource-definition-generator';
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
      audit_trail: true,
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
        filterable: true,
        sortable: true,
        searchable: true,
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
        filterable: true,
        sortable: false,
        searchable: false,
        precision: null,
        scale: null,
        foreignModel: null,
      },
    ],
    relationships: [],
    permissions: {
      admin: {
        actions: ['index', 'show', 'store', 'update', 'destroy'],
        show_fields: ['*'],
        create_fields: { title: 'required', content: 'nullable', status: 'nullable' },
        update_fields: { title: 'sometimes', content: 'nullable' },
        hidden_fields: [],
      },
      viewer: {
        actions: ['index', 'show'],
        show_fields: ['id', 'title', 'content', 'status'],
        create_fields: {},
        update_fields: {},
        hidden_fields: [],
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ResourceDefinitionGenerator
// ---------------------------------------------------------------------------

describe('ResourceDefinitionGenerator', () => {
  const gen = new ResourceDefinitionGenerator();

  it('generates a valid TypeScript file with imports', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("import { z } from 'zod'");
    expect(output).toContain('ModelRegistration');
    expect(output).toContain('PostPolicy');
  });

  it('exports a named ModelRegistration constant', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('postsRegistration');
    expect(output).toContain('ModelRegistration');
  });

  it('sets belongsToOrganization, softDeletes, hasAuditTrail flags', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('belongsToOrganization: true');
    expect(output).toContain('softDeletes: true');
    expect(output).toContain('hasAuditTrail: true');
  });

  it('includes allowedFilters from filterable columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('allowedFilters');
    expect(output).toContain('"title"');
    expect(output).toContain('"status"');
  });

  it('includes allowedSorts from sortable columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('allowedSorts');
    expect(output).toContain('"title"');
  });

  it('includes allowedSearch from searchable columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('allowedSearch');
    expect(output).toContain('"title"');
  });

  it('generates validationStore with role-keyed zod schemas', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('validationStore');
    expect(output).toContain('admin:');
    expect(output).toContain('viewer:');
    expect(output).toContain('z.object(');
  });

  it('generates required fields as z.string() (no .optional())', () => {
    const output = gen.generate(makeBlueprint());
    // title: required → z.string() without optional
    expect(output).toMatch(/title:\s*z\.string\(\)/);
  });

  it('generates nullable fields with .nullable().optional()', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain('.nullable().optional()');
  });

  it('generates sometimes fields with .optional()', () => {
    const output = gen.generate(makeBlueprint());
    // title: sometimes in update_fields
    expect(output).toContain('.optional()');
  });

  it('uses passthrough schema for wildcard create_fields', () => {
    const bp = makeBlueprint({
      permissions: {
        admin: {
          actions: ['store'],
          show_fields: ['*'],
          create_fields: ['*'],
          update_fields: ['*'],
          hidden_fields: [],
        },
      },
    });
    const output = gen.generate(bp);
    expect(output).toContain('passthrough()');
  });

  it('generates enum zod type for enum columns', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("z.enum(['draft', 'published'])");
  });

  it('omits allowedFilters when no columns are filterable', () => {
    const bp = makeBlueprint({
      columns: [
        {
          name: 'name',
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
    expect(output).not.toContain('allowedFilters');
  });

  // -----------------------------------------------------------------
  // BP-003: array-form create_fields / update_fields must respect
  // column.nullable so "required" can be expressed without the object
  // form.
  // -----------------------------------------------------------------
  describe('BP-003: array-form field lists infer presence from column.nullable', () => {
    function makeArrayFormBlueprint(): Blueprint {
      return {
        model: 'Project',
        slug: 'projects',
        table: 'projects',
        source_file: 'projects.yaml',
        options: {
          belongs_to_organization: true,
          soft_deletes: false,
          audit_trail: false,
          has_uuid: false,
          owner: null,
      owner_chain: null,
          except_actions: [],
          pagination: false,
          per_page: 25,
        },
        columns: [
          // Required column: nullable:false (Prisma default)
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
          // Optional column: nullable:true
          {
            name: 'description',
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
          // Required numeric column
          {
            name: 'budget',
            type: 'float',
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
          // Nullable numeric column
          {
            name: 'sponsorId',
            type: 'foreignId',
            nullable: true,
            unique: false,
            index: false,
            default: null,
            filterable: false,
            sortable: false,
            searchable: false,
            precision: null,
            scale: null,
            foreignModel: 'User',
          },
        ],
        relationships: [],
        permissions: {
          admin: {
            // Array form — the BP-003 scenario
            actions: ['index', 'show', 'store', 'update'],
            show_fields: ['*'],
            create_fields: ['title', 'description', 'budget', 'sponsorId'],
            update_fields: ['title', 'description', 'budget', 'sponsorId'],
            hidden_fields: [],
          },
        },
      };
    }

    it('non-nullable column in create_fields array emits a REQUIRED zod type (no .optional)', () => {
      const out = gen.generate(makeArrayFormBlueprint());

      // Expectations — STORE schema:
      //   title: z.string()           (required, nullable:false column)
      //   description: z.string().nullable().optional()  (nullable:true)
      //   budget: z.number()          (required)
      //   sponsorId: z.number().int().nullable().optional()  (nullable:true)

      // Locate the admin store block
      const storeMatch = out.match(/admin:\s*z\.object\(\{([\s\S]*?)\}\)/);
      expect(storeMatch).not.toBeNull();
      const storeBody = storeMatch![1];

      expect(storeBody).toMatch(/title:\s*z\.string\(\)[ \t]*,/);
      expect(storeBody).not.toMatch(/title:\s*z\.string\(\)\.optional\(\)/);

      expect(storeBody).toMatch(/budget:\s*z\.number\(\)[ \t]*,/);
      expect(storeBody).not.toMatch(/budget:\s*z\.number\(\)\.optional\(\)/);

      expect(storeBody).toMatch(/description:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
      expect(storeBody).toMatch(/sponsorId:\s*z\.number\(\)\.int\(\)\.nullable\(\)\.optional\(\)/);
    });

    it('update_fields array makes everything optional (but nullable columns stay nullable)', () => {
      const out = gen.generate(makeArrayFormBlueprint());

      // Find the validationUpdate block specifically
      const updateBlockMatch = out.match(
        /validationUpdate[\s\S]*?admin:\s*z\.object\(\{([\s\S]*?)\}\)/,
      );
      expect(updateBlockMatch).not.toBeNull();
      const updateBody = updateBlockMatch![1];

      // Required-on-create columns become optional (sometimes) on update
      expect(updateBody).toMatch(/title:\s*z\.string\(\)\.optional\(\)/);
      expect(updateBody).toMatch(/budget:\s*z\.number\(\)\.optional\(\)/);

      // Nullable columns stay nullable().optional() on update too
      expect(updateBody).toMatch(/description:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
    });

    it('object-form explicit modifiers still override column.nullable', () => {
      const bp = makeArrayFormBlueprint();
      // Override: explicitly mark title as nullable even though the column is required
      bp.permissions.admin.create_fields = {
        title: 'nullable',
        budget: 'required',
      };
      const out = gen.generate(bp);
      const storeMatch = out.match(/admin:\s*z\.object\(\{([\s\S]*?)\}\)/);
      expect(storeMatch).not.toBeNull();
      expect(storeMatch![1]).toMatch(/title:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
      expect(storeMatch![1]).toMatch(/budget:\s*z\.number\(\)[ \t]*,/);
    });

    it('wildcard ["*"] still maps to passthrough (backwards compat)', () => {
      const bp = makeArrayFormBlueprint();
      bp.permissions.admin.create_fields = ['*'];
      const out = gen.generate(bp);
      expect(out).toMatch(/admin:\s*z\.object\(\{\}\)\.passthrough\(\)/);
    });

    it('empty array → empty object (backwards compat)', () => {
      const bp = makeArrayFormBlueprint();
      bp.permissions.admin.create_fields = [];
      const out = gen.generate(bp);
      // Should emit `admin: z.object({})` (not passthrough, not syntax error)
      const match = out.match(/admin:\s*z\.object\(\{\}\)[,\s]/);
      expect(match).not.toBeNull();
    });

    it('non-nullable column WITH a default is optional on create (DB fills default)', () => {
      const bp = makeArrayFormBlueprint();
      bp.columns.push({
        name: 'status',
        type: 'string',
        nullable: false,
        unique: false,
        index: false,
        default: 'todo',
        filterable: false,
        sortable: false,
        searchable: false,
        precision: null,
        scale: null,
        foreignModel: null,
      });
      bp.permissions.admin.create_fields = ['title', 'status'];
      const out = gen.generate(bp);
      const storeMatch = out.match(/admin:\s*z\.object\(\{([\s\S]*?)\}\)/);
      expect(storeMatch).not.toBeNull();
      const body = storeMatch![1];
      // title: no default + nullable:false → required
      expect(body).toMatch(/title:\s*z\.string\(\)[ \t]*,/);
      // status: has default → optional (.optional()). Won't trip up clients
      // that rely on Prisma/DB defaults.
      expect(body).toMatch(/status:\s*z\.string\(\)\.optional\(\)/);
      expect(body).not.toMatch(/status:\s*z\.string\(\)[ \t]*,/);
    });

    it('unknown field in array falls back to z.string().optional() (graceful)', () => {
      const bp = makeArrayFormBlueprint();
      bp.permissions.admin.create_fields = ['title', 'notAColumn'];
      const out = gen.generate(bp);
      const storeMatch = out.match(/admin:\s*z\.object\(\{([\s\S]*?)\}\)/);
      expect(storeMatch![1]).toMatch(/notAColumn:\s*z\.string\(\)\.optional\(\)/);
      // Real column still gets the required treatment
      expect(storeMatch![1]).toMatch(/title:\s*z\.string\(\)[ \t]*,/);
    });
  });
});
