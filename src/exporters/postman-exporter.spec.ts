import { generatePostmanCollection } from './postman-exporter';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFolder(items: any[], name: string): any | undefined {
  return items.find((i: any) => i.name === name);
}

function collectAllRequests(folder: any): any[] {
  const result: any[] = [];
  if (!folder?.item) return result;
  for (const item of folder.item) {
    if (item.request) {
      result.push(item);
    } else if (item.item) {
      result.push(...collectAllRequests(item));
    }
  }
  return result;
}

function getAllMethods(folder: any): string[] {
  return collectAllRequests(folder).map((r: any) => r.request.method);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePostmanCollection', () => {
  // ---- empty config --------------------------------------------------------

  describe('empty config', () => {
    const collection: any = generatePostmanCollection(
      { models: {} },
      { baseUrl: 'http://localhost:3000/api', projectName: 'TestProject' },
    );

    it('returns a v2.1 collection schema', () => {
      expect(collection.info.schema).toBe(
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      );
    });

    it('uses the supplied project name', () => {
      expect(collection.info.name).toBe('TestProject');
    });

    it('sets baseUrl variable to the supplied value', () => {
      const baseUrlVar = collection.variable.find((v: any) => v.key === 'baseUrl');
      expect(baseUrlVar?.value).toBe('http://localhost:3000/api');
    });

    it('always includes an Authentication folder', () => {
      const authFolder = findFolder(collection.item, 'Authentication');
      expect(authFolder).toBeDefined();
    });

    it('has no model folders when models is empty', () => {
      const folders = collection.item.filter((i: any) => i.name !== 'Authentication');
      expect(folders).toHaveLength(0);
    });
  });

  // ---- single model --------------------------------------------------------

  describe('single model — posts', () => {
    const config: RhinoConfig = {
      models: {
        posts: {
          model: 'post',
          allowedFilters: ['status', 'author_id'],
          allowedSorts: ['createdAt', 'title'],
          allowedFields: ['id', 'title', 'body', 'status'],
          allowedIncludes: ['author', 'comments'],
          allowedSearch: ['title', 'body'],
          paginationEnabled: true,
        },
      },
    };

    const collection: any = generatePostmanCollection(config, {
      baseUrl: 'http://localhost:3000/api',
    });

    it('creates a top-level folder named "posts"', () => {
      expect(findFolder(collection.item, 'posts')).toBeDefined();
    });

    const postsFolder = () => findFolder(collection.item, 'posts');

    it('has Index, Show, Store, Update, Destroy sub-folders', () => {
      const names = postsFolder().item.map((f: any) => f.name);
      expect(names).toEqual(expect.arrayContaining(['Index', 'Show', 'Store', 'Update', 'Destroy']));
    });

    it('does NOT include soft-delete folders when softDeletes is false', () => {
      const names = postsFolder().item.map((f: any) => f.name);
      expect(names).not.toContain('Trashed');
      expect(names).not.toContain('Restore');
      expect(names).not.toContain('Force Delete');
    });

    it('Index folder contains filter requests for each allowedFilter', () => {
      const indexFolder = findFolder(postsFolder().item, 'Index');
      const requests = collectAllRequests(indexFolder);
      const names = requests.map((r: any) => r.name);
      expect(names).toContain('Filter by status');
      expect(names).toContain('Filter by author_id');
    });

    it('Index folder contains sort requests for each allowedSort', () => {
      const indexFolder = findFolder(postsFolder().item, 'Index');
      const requests = collectAllRequests(indexFolder);
      const names = requests.map((r: any) => r.name);
      expect(names).toContain('Sort by createdAt (asc)');
      expect(names).toContain('Sort by createdAt (desc)');
      expect(names).toContain('Sort by title (asc)');
    });

    it('Index folder contains include requests for each allowedInclude', () => {
      const indexFolder = findFolder(postsFolder().item, 'Index');
      const requests = collectAllRequests(indexFolder);
      const names = requests.map((r: any) => r.name);
      expect(names).toContain('Include author');
      expect(names).toContain('Include comments');
      expect(names).toContain('Include all');
    });

    it('Index folder contains a Search request when allowedSearch is set', () => {
      const indexFolder = findFolder(postsFolder().item, 'Index');
      const requests = collectAllRequests(indexFolder);
      const names = requests.map((r: any) => r.name);
      expect(names).toContain('Search');
    });

    it('Index folder contains Paginate and Combined requests', () => {
      const indexFolder = findFolder(postsFolder().item, 'Index');
      const requests = collectAllRequests(indexFolder);
      const names = requests.map((r: any) => r.name);
      expect(names).toContain('Paginate');
      expect(names).toContain('Combined');
    });

    it('Show folder has GET requests including "Show by ID"', () => {
      const showFolder = findFolder(postsFolder().item, 'Show');
      const methods = getAllMethods(showFolder);
      expect(methods.every((m: string) => m === 'GET')).toBe(true);
      const names = collectAllRequests(showFolder).map((r: any) => r.name);
      expect(names).toContain('Show by ID');
    });

    it('Store folder has a POST "Create" request', () => {
      const storeFolder = findFolder(postsFolder().item, 'Store');
      const req = collectAllRequests(storeFolder).find((r: any) => r.name === 'Create');
      expect(req).toBeDefined();
      expect(req.request.method).toBe('POST');
    });

    it('Update folder has PUT requests', () => {
      const updateFolder = findFolder(postsFolder().item, 'Update');
      const methods = getAllMethods(updateFolder);
      expect(methods.every((m: string) => m === 'PUT')).toBe(true);
    });

    it('Destroy folder has a DELETE request', () => {
      const destroyFolder = findFolder(postsFolder().item, 'Destroy');
      const methods = getAllMethods(destroyFolder);
      expect(methods).toContain('DELETE');
    });

    it('all requests include Authorization Bearer header', () => {
      const requests = collectAllRequests(postsFolder());
      for (const req of requests) {
        const authHeader = (req.request.header as any[]).find(
          (h: any) => h.key === 'Authorization',
        );
        expect(authHeader?.value).toBe('Bearer {{token}}');
      }
    });
  });

  // ---- soft-delete routes --------------------------------------------------

  describe('soft deletes enabled', () => {
    const config: RhinoConfig = {
      models: {
        articles: {
          model: 'article',
          softDeletes: true,
          allowedSorts: ['publishedAt'],
        },
      },
    };

    const collection: any = generatePostmanCollection(config, {
      baseUrl: 'http://localhost:3000/api',
    });

    const articlesFolder = () => findFolder(collection.item, 'articles');

    it('has Trashed, Restore, and Force Delete folders', () => {
      const names = articlesFolder().item.map((f: any) => f.name);
      expect(names).toContain('Trashed');
      expect(names).toContain('Restore');
      expect(names).toContain('Force Delete');
    });

    it('Trashed folder has a GET "List trashed" request', () => {
      const trashedFolder = findFolder(articlesFolder().item, 'Trashed');
      const names = collectAllRequests(trashedFolder).map((r: any) => r.name);
      expect(names).toContain('List trashed');
    });

    it('Restore folder has a POST request to /restore', () => {
      const restoreFolder = findFolder(articlesFolder().item, 'Restore');
      const req = collectAllRequests(restoreFolder)[0];
      expect(req.request.method).toBe('POST');
      expect(req.request.url.raw).toContain('/restore');
    });

    it('Force Delete folder has a DELETE request to /force-delete', () => {
      const forceDeleteFolder = findFolder(articlesFolder().item, 'Force Delete');
      const req = collectAllRequests(forceDeleteFolder)[0];
      expect(req.request.method).toBe('DELETE');
      expect(req.request.url.raw).toContain('/force-delete');
    });
  });

  // ---- soft deletes are NOT included when disabled via exceptActions -------

  describe('exceptActions hides soft-delete routes', () => {
    const config: RhinoConfig = {
      models: {
        articles: {
          model: 'article',
          softDeletes: true,
          exceptActions: ['trashed', 'restore', 'forceDelete'],
        },
      },
    };

    const collection: any = generatePostmanCollection(config, {
      baseUrl: 'http://localhost:3000/api',
    });

    it('omits Trashed / Restore / Force Delete when listed in exceptActions', () => {
      const articlesFolder = findFolder(collection.item, 'articles');
      const names = articlesFolder.item.map((f: any) => f.name);
      expect(names).not.toContain('Trashed');
      expect(names).not.toContain('Restore');
      expect(names).not.toContain('Force Delete');
    });
  });

  // ---- multiple route groups -----------------------------------------------

  describe('multiple route groups', () => {
    const config: RhinoConfig = {
      models: {
        posts: { model: 'post' },
        pages: { model: 'page' },
      },
      routeGroups: {
        public: { models: ['pages'], prefix: 'public' },
        tenant: { models: ['posts', 'pages'], prefix: '{organization}' },
      },
    };

    const collection: any = generatePostmanCollection(config, {
      baseUrl: 'http://localhost:3000/api',
    });

    it('creates a top-level folder per group', () => {
      const names = collection.item.map((i: any) => i.name);
      expect(names).toContain('public');
      expect(names).toContain('tenant');
    });

    it('public group contains only pages', () => {
      const publicFolder = findFolder(collection.item, 'public');
      const modelNames = publicFolder.item.map((f: any) => f.name);
      expect(modelNames).toContain('pages');
      expect(modelNames).not.toContain('posts');
    });

    it('tenant group contains both posts and pages', () => {
      const tenantFolder = findFolder(collection.item, 'tenant');
      const modelNames = tenantFolder.item.map((f: any) => f.name);
      expect(modelNames).toContain('posts');
      expect(modelNames).toContain('pages');
    });

    it('adds organization variable when prefix contains a route param', () => {
      const vars = collection.variable.map((v: any) => v.key);
      expect(vars).toContain('organization');
    });

    it('tenant routes include the org param in the URL', () => {
      const tenantFolder = findFolder(collection.item, 'tenant');
      const postsFolder = findFolder(tenantFolder.item, 'posts');
      const indexFolder = findFolder(postsFolder.item, 'Index');
      const listReq = collectAllRequests(indexFolder).find((r: any) => r.name === 'List all');
      expect(listReq?.request.url.raw).toContain('{{organization}}');
    });
  });

  // ---- auth routes ---------------------------------------------------------

  describe('auth folder', () => {
    const collection: any = generatePostmanCollection(
      { models: {} },
      { baseUrl: 'http://localhost:3000/api' },
    );

    const authFolder = findFolder(collection.item, 'Authentication');

    it('contains Login, Logout, Password recover, Password reset, Register', () => {
      const names = authFolder.item.map((i: any) => i.name);
      expect(names).toContain('Login');
      expect(names).toContain('Logout');
      expect(names).toContain('Password recover');
      expect(names).toContain('Password reset');
      expect(names).toContain('Register');
    });

    it('Login request targets /auth/login', () => {
      const login = authFolder.item.find((i: any) => i.name === 'Login');
      expect(login?.request.url.raw).toContain('/auth/login');
    });

    it('Login has a test script that captures the token', () => {
      const login = authFolder.item.find((i: any) => i.name === 'Login');
      const script = login?.event?.[0]?.script?.exec?.join('\n') ?? '';
      expect(script).toContain('pm.collectionVariables.set("token"');
    });

    it('does NOT include Accept invitation when multiTenant is not enabled', () => {
      const names = authFolder.item.map((i: any) => i.name);
      expect(names).not.toContain('Accept invitation');
    });
  });

  // ---- multi-tenant: invitation route ---------------------------------------

  describe('multi-tenant invitation route', () => {
    const config: RhinoConfig = {
      models: {},
      multiTenant: { enabled: true, organizationIdentifierColumn: 'slug' },
    };

    const collection: any = generatePostmanCollection(config, {
      baseUrl: 'http://localhost:3000/api',
    });

    it('includes Accept invitation in the Authentication folder when multiTenant enabled', () => {
      const authFolder = findFolder(collection.item, 'Authentication');
      const names = authFolder.item.map((i: any) => i.name);
      expect(names).toContain('Accept invitation');
    });

    it('Accept invitation request targets /invitations/accept', () => {
      const authFolder = findFolder(collection.item, 'Authentication');
      const req = authFolder.item.find((i: any) => i.name === 'Accept invitation');
      expect(req?.request.url.raw).toContain('/invitations/accept');
    });
  });

  // ---- default project name ------------------------------------------------

  it('uses "Rhino API" as the default project name', () => {
    const col: any = generatePostmanCollection({ models: {} }, { baseUrl: 'http://localhost' });
    expect(col.info.name).toBe('Rhino API');
  });

  // ---- trailing slash stripped from baseUrl --------------------------------

  it('strips trailing slash from baseUrl', () => {
    const col: any = generatePostmanCollection(
      { models: {} },
      { baseUrl: 'http://localhost:3000/api/' },
    );
    const baseUrlVar = col.variable.find((v: any) => v.key === 'baseUrl');
    expect(baseUrlVar?.value).toBe('http://localhost:3000/api');
  });
});
