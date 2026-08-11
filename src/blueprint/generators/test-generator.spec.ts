import { TestGenerator } from './test-generator';
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
    relationships: [],
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
        show_fields: ['id', 'title', 'status'],
        create_fields: {},
        update_fields: {},
        hidden_fields: [],
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TestGenerator
// ---------------------------------------------------------------------------

describe('TestGenerator', () => {
  const gen = new TestGenerator();

  it('generates a TypeScript spec file with imports', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("import { buildEnv }");
    expect(output).toContain("RhinoConfig");
  });

  it('includes a describe block for the model', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("describe('Post resource'");
  });

  it('generates CRUD happy-path tests', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("it('index returns records for the current org'");
    expect(output).toContain("it('show returns a single record by id'");
    expect(output).toContain("it('store persists a new record'");
    expect(output).toContain("it('update modifies an existing record'");
    expect(output).toContain("it('destroy removes (or soft-deletes) the record'");
  });

  it('calls GlobalController with the real (modelSlug, query, req) signature', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain(".index('posts', {}, req)");
    expect(output).toContain(".show('posts', '1', {}, req)");
    expect(output).toContain(".store('posts', body, req)");
    expect(output).toContain(".update('posts', '1', body, req)");
    expect(output).toContain(".destroy('posts', '1', req)");
  });

  it('generates a 403 test for restricted role', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("403");
    expect(output).toContain("store");
  });

  it('generates a 404 cross-tenant test when belongs_to_organization', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("404");
    expect(output).toContain("organizationId: 99");
  });

  it('does NOT generate cross-tenant test when belongs_to_organization is false', () => {
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
    expect(output).not.toContain("organizationId: 99");
  });

  it('uses the NOT_FOUND RhinoException code for cross-tenant test', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("code: 'NOT_FOUND'");
  });

  it('includes buildEnv call in CRUD tests', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("buildEnv(makeConfig()");
  });

  it('includes makeUser helper that matches permission-matcher.ts shape', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("function makeUser(");
    // permission-matcher.ts reads user.userRoles[n].{organizationId, permissions, role.slug}
    expect(output).toContain("userRoles:");
    expect(output).toContain("organizationId: orgId");
    expect(output).toContain("role: { slug: role }");
  });

  it('passes slug-scoped permissions to makeUser for admin', () => {
    const output = gen.generate(makeBlueprint());
    // admin has actions: [index, show, store, update, destroy] → posts.index, etc.
    expect(output).toContain("makeUser('admin', adminPerms)");
    expect(output).toContain("posts.index");
    expect(output).toContain("posts.store");
  });

  it('uses viewer role for 403 test (no store permission)', () => {
    const output = gen.generate(makeBlueprint());
    expect(output).toContain("makeUser('viewer'");
  });

  it('generates sampleRow with enum default for enum columns', () => {
    const output = gen.generate(makeBlueprint());
    // sampleRow should have status as 'draft' (first enum value)
    expect(output).toContain('"status": "draft"');
  });

  it('handles blueprint with no permissions gracefully', () => {
    const bp = makeBlueprint({ permissions: {} });
    const output = gen.generate(bp);
    expect(output).toContain("describe('Post resource'");
    // Should not throw
  });

  describe('route_key threading', () => {
    function makeRouteKeyBlueprint(): Blueprint {
      const bp = makeBlueprint();
      bp.options = { ...bp.options, route_key: 'hashId' };
      return bp;
    }

    it('emits routeKey in the generated makeConfig registration', () => {
      const output = gen.generate(makeRouteKeyBlueprint());
      expect(output).toContain(`routeKey: "hashId",`);
    });

    it('sampleRow carries a deterministic route-key value', () => {
      const output = gen.generate(makeRouteKeyBlueprint());
      expect(output).toContain('"hashId": "sample-route-key-1"');
    });

    it('member-endpoint calls address the record by the route-key value, not the PK', () => {
      const output = gen.generate(makeRouteKeyBlueprint());
      expect(output).toContain(`show('posts', "sample-route-key-1"`);
      expect(output).toContain(`update('posts', "sample-route-key-1"`);
      expect(output).toContain(`destroy('posts', "sample-route-key-1"`);
      expect(output).not.toContain(`show('posts', '1'`);
    });

    it('keeps the PK literal for record assertions (id stays 1)', () => {
      const output = gen.generate(makeRouteKeyBlueprint());
      expect(output).toContain('id: 1');
    });

    it('without route_key the route param stays the PK (backwards compat)', () => {
      const output = gen.generate(makeBlueprint());
      expect(output).toContain(`show('posts', '1'`);
      expect(output).not.toContain('routeKey');
    });
  });
});
