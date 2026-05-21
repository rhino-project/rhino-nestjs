import type { RhinoConfig, ModelRegistration } from '../interfaces/rhino-config.interface';

export interface PostmanExporterOptions {
  baseUrl: string;
  projectName?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Postman Collection v2.1 JSON object from an RhinoConfig.
 *
 * The returned value is a plain JS object that can be serialised with
 * `JSON.stringify`.  Prisma model names are not available at export time, so
 * request bodies use field-name placeholders derived from the config hints
 * (allowedFilters / allowedFields / …).
 */
export function generatePostmanCollection(
  config: RhinoConfig,
  options: PostmanExporterOptions,
): object {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const projectName = options.projectName ?? 'Rhino API';

  const models = config.models ?? {};
  const routeGroups = config.routeGroups ?? {};
  const groupNames = Object.keys(routeGroups);
  const hasMultipleGroups = groupNames.length > 1;
  const multiTenantEnabled = isMultiTenantEnabled(config);

  const needsOrgVariable = groupNames.some(name => {
    const prefix = routeGroups[name].prefix ?? '';
    return prefixHasParam(prefix);
  });

  const variables = buildCollectionVariables(baseUrl, needsOrgVariable);
  const items: object[] = [];

  // Auth folder is always first
  items.push(buildAuthFolder(multiTenantEnabled));

  if (hasMultipleGroups) {
    for (const groupName of groupNames) {
      const group = routeGroups[groupName];
      const slugList = group.models === '*' ? Object.keys(models) : group.models;
      const groupItems: object[] = [];
      for (const slug of slugList) {
        const reg = models[slug];
        if (!reg) continue;
        const modelFolder = buildModelFolder(slug, reg, group.prefix ?? '');
        groupItems.push(modelFolder);
      }
      if (groupItems.length > 0) {
        items.push({ name: groupName, item: groupItems });
      }
    }
  } else if (groupNames.length === 1) {
    const groupName = groupNames[0];
    const group = routeGroups[groupName];
    const slugList = group.models === '*' ? Object.keys(models) : group.models;
    for (const slug of slugList) {
      const reg = models[slug];
      if (!reg) continue;
      items.push(buildModelFolder(slug, reg, group.prefix ?? ''));
    }
  } else {
    // No route groups — flat list
    for (const [slug, reg] of Object.entries(models)) {
      items.push(buildModelFolder(slug, reg, ''));
    }
  }

  return {
    info: {
      name: projectName,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: variables,
    item: items,
  };
}

// ---------------------------------------------------------------------------
// Helpers — variables & headers
// ---------------------------------------------------------------------------

function isMultiTenantEnabled(config: RhinoConfig): boolean {
  const mt = config.multiTenant;
  if (!mt) return false;
  if (mt.enabled === false) return false;
  return mt.enabled === true || Boolean(mt.organizationIdentifierColumn);
}

function prefixHasParam(prefix: string): boolean {
  return prefix.includes('{') || prefix.includes(':');
}

function buildCollectionVariables(baseUrl: string, needsOrgVariable: boolean): object[] {
  const vars: object[] = [
    { key: 'baseUrl', value: baseUrl },
    { key: 'modelId', value: '1' },
    { key: 'token', value: '' },
  ];
  if (needsOrgVariable) {
    vars.push({ key: 'organization', value: 'organization-1' });
  }
  return vars;
}

function defaultHeaders(): object[] {
  return [
    { key: 'Accept', value: 'application/json' },
    { key: 'Authorization', value: 'Bearer {{token}}' },
  ];
}

function jsonHeaders(): object[] {
  return [
    ...defaultHeaders(),
    { key: 'Content-Type', value: 'application/json' },
  ];
}

// ---------------------------------------------------------------------------
// Auth folder
// ---------------------------------------------------------------------------

function buildAuthFolder(multiTenantEnabled: boolean): object {
  const loginTestScript =
    'const json = pm.response.json();\n' +
    'if (json.token) {\n' +
    '    pm.collectionVariables.set("token", json.token);\n' +
    '}\n' +
    'if (json.organization_slug) {\n' +
    '    pm.collectionVariables.set("organization", json.organization_slug);\n' +
    '}';

  const items: object[] = [
    requestItem('Login', 'POST', '{{baseUrl}}/auth/login', {}, jsonHeaders(), {
      email: 'user@example.com',
      password: 'password',
    }, loginTestScript),
    requestItem('Logout', 'POST', '{{baseUrl}}/auth/logout', {}, defaultHeaders()),
    requestItem('Password recover', 'POST', '{{baseUrl}}/auth/password/recover', {}, jsonHeaders(), {
      email: 'user@example.com',
    }),
    requestItem('Password reset', 'POST', '{{baseUrl}}/auth/password/reset', {}, jsonHeaders(), {
      token: '{{token}}',
      email: 'user@example.com',
      password: 'new-password',
      password_confirmation: 'new-password',
    }),
    requestItem('Register', 'POST', '{{baseUrl}}/auth/register', {}, jsonHeaders(), {
      invitation_token: '{{token}}',
      name: 'New User',
      password: 'password',
      password_confirmation: 'password',
    }),
  ];

  if (multiTenantEnabled) {
    items.push(
      requestItem('Accept invitation', 'POST', '{{baseUrl}}/invitations/accept', {}, jsonHeaders(), {
        token: 'invitation-token',
      }),
    );
  }

  return { name: 'Authentication', item: items };
}

// ---------------------------------------------------------------------------
// Model folder
// ---------------------------------------------------------------------------

function buildModelFolder(
  slug: string,
  reg: ModelRegistration,
  groupPrefix: string,
): object {
  const basePath = buildBasePath(slug, groupPrefix);
  const exceptActions = reg.exceptActions ?? [];
  const folders: object[] = [];

  if (!exceptActions.includes('index')) {
    folders.push({ name: 'Index', item: buildIndexRequests(basePath, slug, reg) });
  }
  if (!exceptActions.includes('show')) {
    folders.push({ name: 'Show', item: buildShowRequests(basePath, slug, reg) });
  }
  if (!exceptActions.includes('store')) {
    folders.push({ name: 'Store', item: buildStoreRequests(basePath, reg) });
  }
  if (!exceptActions.includes('update')) {
    folders.push({ name: 'Update', item: buildUpdateRequests(basePath, reg) });
  }
  if (!exceptActions.includes('destroy')) {
    folders.push({ name: 'Destroy', item: buildDestroyRequests(basePath) });
  }

  if (reg.softDeletes) {
    if (!exceptActions.includes('trashed')) {
      folders.push({ name: 'Trashed', item: buildTrashedRequests(basePath, reg) });
    }
    if (!exceptActions.includes('restore')) {
      folders.push({ name: 'Restore', item: buildRestoreRequests(basePath) });
    }
    if (!exceptActions.includes('forceDelete')) {
      folders.push({ name: 'Force Delete', item: buildForceDeleteRequests(basePath) });
    }
  }

  return { name: slug, item: folders };
}

function buildBasePath(slug: string, groupPrefix: string): string {
  if (groupPrefix) {
    // Replace {param} or :param with {{param}} for Postman variables
    const postmanPrefix = groupPrefix
      .replace(/\{(\w+)\}/g, '{{$1}}')
      .replace(/:(\w+)/g, '{{$1}}');
    return `{{baseUrl}}/${postmanPrefix}/${slug}`;
  }
  return `{{baseUrl}}/${slug}`;
}

// ---------------------------------------------------------------------------
// CRUD request builders
// ---------------------------------------------------------------------------

function buildIndexRequests(basePath: string, slug: string, reg: ModelRegistration): object[] {
  const requests: object[] = [];
  const hdrs = defaultHeaders();

  requests.push(requestItem('List all', 'GET', basePath, {}, hdrs));

  for (const filter of reg.allowedFilters ?? []) {
    requests.push(
      requestItem(`Filter by ${filter}`, 'GET', basePath, {
        [`filter[${filter}]`]: exampleFilterValue(filter),
      }, hdrs),
    );
  }

  for (const sort of reg.allowedSorts ?? []) {
    requests.push(requestItem(`Sort by ${sort} (asc)`, 'GET', basePath, { sort }, hdrs));
    requests.push(requestItem(`Sort by ${sort} (desc)`, 'GET', basePath, { sort: `-${sort}` }, hdrs));
  }

  const includes = reg.allowedIncludes ?? [];
  for (const include of includes) {
    requests.push(requestItem(`Include ${include}`, 'GET', basePath, { include }, hdrs));
  }
  if (includes.length > 1) {
    requests.push(
      requestItem('Include all', 'GET', basePath, { include: includes.join(',') }, hdrs),
    );
  }

  const fields = reg.allowedFields ?? [];
  if (fields.length > 0) {
    requests.push(
      requestItem('Select fields', 'GET', basePath, {
        [`fields[${slug}]`]: fields.slice(0, 5).join(','),
      }, hdrs),
    );
  }

  if ((reg.allowedSearch ?? []).length > 0) {
    requests.push(requestItem('Search', 'GET', basePath, { search: 'example' }, hdrs));
  }

  if (reg.paginationEnabled !== false) {
    requests.push(requestItem('Paginate', 'GET', basePath, { per_page: '25', page: '1' }, hdrs));
  }

  // Combined example
  const combined: Record<string, string> = {};
  if ((reg.allowedFilters ?? []).length > 0) {
    const f = reg.allowedFilters![0];
    combined[`filter[${f}]`] = exampleFilterValue(f);
  }
  if ((reg.allowedSorts ?? []).length > 0) {
    combined['sort'] = `-${reg.defaultSort ?? reg.allowedSorts![0]}`;
  }
  if (includes.length > 0) {
    combined['include'] = includes.slice(0, 2).join(',');
  }
  if (fields.length > 0) {
    combined[`fields[${slug}]`] = fields.slice(0, 3).join(',');
  }
  combined['per_page'] = '10';
  combined['page'] = '1';
  requests.push(requestItem('Combined', 'GET', basePath, combined, hdrs));

  return requests;
}

function buildShowRequests(basePath: string, slug: string, reg: ModelRegistration): object[] {
  const path = `${basePath}/{{modelId}}`;
  const hdrs = defaultHeaders();
  const requests: object[] = [
    requestItem('Show by ID', 'GET', path, {}, hdrs),
  ];
  const includes = reg.allowedIncludes ?? [];
  if (includes.length > 0) {
    requests.push(
      requestItem('Show with include', 'GET', path, { include: includes[0] }, hdrs),
    );
  }
  const fields = reg.allowedFields ?? [];
  if (fields.length > 0) {
    requests.push(
      requestItem('Show with fields', 'GET', path, {
        [`fields[${slug}]`]: fields.slice(0, 5).join(','),
      }, hdrs),
    );
  }
  return requests;
}

function buildStoreRequests(basePath: string, reg: ModelRegistration): object[] {
  const body = buildExampleBody(reg);
  return [requestItem('Create', 'POST', basePath, {}, jsonHeaders(), body)];
}

function buildUpdateRequests(basePath: string, reg: ModelRegistration): object[] {
  const path = `${basePath}/{{modelId}}`;
  const body = buildExampleBody(reg);
  const requests: object[] = [
    requestItem('Update', 'PUT', path, {}, jsonHeaders(), body),
  ];
  if (Object.keys(body).length > 1) {
    const [firstKey] = Object.keys(body);
    requests.push(
      requestItem('Update partial', 'PUT', path, {}, jsonHeaders(), { [firstKey]: body[firstKey] }),
    );
  }
  return requests;
}

function buildDestroyRequests(basePath: string): object[] {
  return [requestItem('Delete by ID', 'DELETE', `${basePath}/{{modelId}}`, {}, defaultHeaders())];
}

function buildTrashedRequests(basePath: string, reg: ModelRegistration): object[] {
  const path = `${basePath}/trashed`;
  const hdrs = defaultHeaders();
  const requests: object[] = [requestItem('List trashed', 'GET', path, {}, hdrs)];
  if ((reg.allowedSorts ?? []).length > 0) {
    requests.push(
      requestItem('List trashed sorted', 'GET', path, { sort: '-deletedAt' }, hdrs),
    );
  }
  return requests;
}

function buildRestoreRequests(basePath: string): object[] {
  return [requestItem('Restore by ID', 'POST', `${basePath}/{{modelId}}/restore`, {}, defaultHeaders())];
}

function buildForceDeleteRequests(basePath: string): object[] {
  return [requestItem('Force delete by ID', 'DELETE', `${basePath}/{{modelId}}/force-delete`, {}, defaultHeaders())];
}

// ---------------------------------------------------------------------------
// Body / value helpers
// ---------------------------------------------------------------------------

function buildExampleBody(reg: ModelRegistration): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const fields = reg.allowedFields ?? [];
  const filters = reg.allowedFilters ?? [];
  // Prefer allowedFields as the body skeleton; fall back to filters for hints
  const candidates = fields.length > 0 ? fields : filters;
  for (const field of candidates) {
    body[field] = exampleValueForField(field);
  }
  return body;
}

function exampleFilterValue(filter: string): string {
  const lower = filter.toLowerCase();
  if (['is_published', 'is_active', 'published', 'active'].includes(lower)) return '1';
  return 'example';
}

function exampleValueForField(field: string): unknown {
  const lower = field.toLowerCase();
  if (lower.endsWith('_id') || lower === 'id') return 1;
  if (['is_published', 'is_active', 'active', 'published', 'enabled'].includes(lower)) return true;
  if (lower.endsWith('_at') || lower.includes('date')) return '2024-01-01T00:00:00Z';
  if (lower === 'email') return 'user@example.com';
  if (lower === 'name' || lower === 'title') return `Example ${field}`;
  return `example-${field}`;
}

// ---------------------------------------------------------------------------
// Core request item builder
// ---------------------------------------------------------------------------

function requestItem(
  name: string,
  method: string,
  path: string,
  queryParams: Record<string, string>,
  headers: object[],
  body?: Record<string, unknown> | null,
  testScript?: string,
): object {
  const query: Array<{ key: string; value: string }> = Object.entries(queryParams).map(
    ([key, value]) => ({ key, value }),
  );

  const rawUrl =
    query.length > 0
      ? `${path}?${query.map(q => `${q.key}=${encodeURIComponent(q.value)}`).join('&')}`
      : path;

  // Split path into host + path parts for Postman URL structure
  // The path looks like "{{baseUrl}}/segment/..."
  const withoutProtocol = path.replace(/^https?:\/\//, '');
  const parts = withoutProtocol.split('/').filter(Boolean);

  const urlObj: Record<string, unknown> = {
    raw: rawUrl,
    host: [parts[0] ?? '{{baseUrl}}'],
    path: parts.slice(1),
  };
  if (query.length > 0) {
    urlObj['query'] = query;
  }

  const request: Record<string, unknown> = {
    method,
    header: headers,
    url: urlObj,
  };

  if (body != null && ['POST', 'PUT', 'PATCH'].includes(method)) {
    request['body'] = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  const item: Record<string, unknown> = { name, request };

  if (testScript) {
    item['event'] = [
      {
        listen: 'test',
        script: {
          exec: testScript.split('\n'),
          type: 'text/javascript',
        },
      },
    ];
  }

  return item;
}

// ---------------------------------------------------------------------------
// CLI-compatible alias
// ---------------------------------------------------------------------------

/**
 * Alias for `generatePostmanCollection` that serialises the result to a JSON
 * string.  Used by the CLI command which expects a string back.
 *
 * @internal  Prefer `generatePostmanCollection` in library code.
 */
export function generate(
  config: RhinoConfig,
  options: PostmanExporterOptions,
): string {
  return JSON.stringify(generatePostmanCollection(config, options), null, 2);
}
