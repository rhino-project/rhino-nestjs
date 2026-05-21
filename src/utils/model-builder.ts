import type {
  ModelRegistration,
} from '../interfaces/rhino-config.interface';

/**
 * Sugar for declaring a model with its settings grouped by concern. Returns a
 * flat `ModelRegistration` compatible with `RhinoModule.forRoot`.
 *
 *   const posts = defineModel({
 *     model: 'post',
 *     policy: PostPolicy,
 *     features: { softDeletes: true, auditTrail: true, multiTenant: true, uuid: false },
 *     query: {
 *       filters: ['status', 'authorId'],
 *       sorts: ['-createdAt', 'title'],
 *       search: ['title', 'body'],
 *       includes: ['author', 'comments'],
 *       fields: ['id', 'title', 'body', 'status'],
 *       perPage: 25,
 *     },
 *     validation: { base: PostSchema, store: {...}, update: {...} },
 *     response: { hidden: ['internalNotes'], computed: (r) => ({ ... }) },
 *     restrict: { except: ['destroy'] },
 *     scopes: [PostScope],
 *     fkConstraints: [{ field: 'projectId', model: 'project' }],
 *   });
 */
export interface ModelDefinition {
  /** Prisma model name (camelCase or PascalCase). */
  model: ModelRegistration['model'];
  policy?: ModelRegistration['policy'];

  features?: {
    multiTenant?: boolean;
    softDeletes?: boolean;
    auditTrail?: boolean;
    uuid?: boolean;
  };

  query?: {
    filters?: string[];
    sorts?: string[];
    defaultSort?: string;
    search?: string[];
    includes?: string[];
    fields?: string[];
    pagination?: boolean;
    perPage?: number;
  };

  validation?: {
    base?: ModelRegistration['validation'];
    store?: ModelRegistration['validationStore'];
    update?: ModelRegistration['validationUpdate'];
  };

  response?: {
    hidden?: string[];
    computed?: ModelRegistration['computedAttributes'];
  };

  restrict?: {
    except?: string[];
  };

  middleware?: ModelRegistration['middleware'];
  actionMiddleware?: ModelRegistration['actionMiddleware'];
  scopes?: ModelRegistration['scopes'];
  fkConstraints?: ModelRegistration['fkConstraints'];
  owner?: ModelRegistration['owner'];
  auditExclude?: ModelRegistration['auditExclude'];
}

export function defineModel(def: ModelDefinition): ModelRegistration {
  const out: ModelRegistration = {
    model: def.model,
    policy: def.policy,
  };

  // features
  if (def.features?.multiTenant) out.belongsToOrganization = true;
  if (def.features?.softDeletes) out.softDeletes = true;
  if (def.features?.auditTrail) out.hasAuditTrail = true;
  if (def.features?.uuid) out.hasUuid = true;

  // query
  if (def.query) {
    if (def.query.filters) out.allowedFilters = def.query.filters;
    if (def.query.sorts) out.allowedSorts = def.query.sorts;
    if (def.query.defaultSort) out.defaultSort = def.query.defaultSort;
    if (def.query.search) out.allowedSearch = def.query.search;
    if (def.query.includes) out.allowedIncludes = def.query.includes;
    if (def.query.fields) out.allowedFields = def.query.fields;
    if (def.query.pagination != null) out.paginationEnabled = def.query.pagination;
    if (def.query.perPage != null) out.perPage = def.query.perPage;
  }

  // validation
  if (def.validation?.base) out.validation = def.validation.base;
  if (def.validation?.store) out.validationStore = def.validation.store;
  if (def.validation?.update) out.validationUpdate = def.validation.update;

  // response
  if (def.response?.hidden) out.additionalHiddenColumns = def.response.hidden;
  if (def.response?.computed) out.computedAttributes = def.response.computed;

  // restrict
  if (def.restrict?.except) out.exceptActions = def.restrict.except;

  // pass-through
  if (def.middleware) out.middleware = def.middleware;
  if (def.actionMiddleware) out.actionMiddleware = def.actionMiddleware;
  if (def.scopes) out.scopes = def.scopes;
  if (def.fkConstraints) out.fkConstraints = def.fkConstraints;
  if (def.owner) out.owner = def.owner;
  if (def.auditExclude) out.auditExclude = def.auditExclude;

  return out;
}
