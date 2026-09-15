import type { Type } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { ResourcePolicy } from '../policies/resource-policy';
import type { PrismaClientLike } from '../prisma/prisma.service';
import type { RhinoNamedScope } from '../services/scope.service';

/**
 * Callable behind an opt-in record-level computed attribute.
 *
 * `args` carries the client-supplied arguments, keyed by the parameter names
 * the declaration listed. It is a third POSITIONAL parameter rather than a
 * property on a context object because the existing signature is positional and
 * adding a parameter is non-breaking; collection attributes get the same object
 * on `ctx.args`.
 *
 * Serialization is synchronous, so a record callable must not be async — a
 * promise returned here lands in the response.
 */
export type RecordComputedAttribute = (
  record: any,
  user: any,
  args?: Record<string, any>,
) => any;

/**
 * Extended declaration for a record-level computed attribute that takes
 * client-supplied parameters, sent as `?computed_attributes[name][param]=value`.
 *
 * A declaration is treated as a spec if and only if it is an object carrying at
 * least one of `params` / `optionalParams` / `using`. Anything else — a
 * function, a scalar, an array, an object without those keys — stays a LEGACY
 * declaration and behaves exactly as it does today, so an existing literal
 * declaration can never be reinterpreted as a parameter list.
 */
export interface RecordComputedAttributeSpec {
  /** Declared parameter names, in declared order. */
  params?: string[];
  /** Declared parameters the client may omit; absent from `args` when omitted. */
  optionalParams?: string[];
  /** The callable; `args` carries the bound arguments. */
  using?: RecordComputedAttribute;
}

/** Context handed to a collection-level computed attribute. */
export interface CollectionComputedContext {
  /** Fully scoped Prisma where filter — org scope, model scopes, ?scope=, ?filter[]=, ?search=. */
  where: Record<string, any>;
  /** Prisma delegate for this model (e.g. `prisma.user`). */
  delegate: any;
  /** The Prisma client, for aggregates that need to reach other models. */
  prisma: PrismaClientLike;
  user?: any;
  organization?: any;
  modelSlug: string;
  /**
   * Client-supplied arguments, keyed by the parameter names the declaration
   * listed. Empty unless the attribute declared `params`. An omitted optional
   * parameter is simply absent.
   *
   * These values are client input: use them as bound predicate values only.
   * They reach the callable AFTER the organization scope is applied to
   * `ctx.where`, and must never be interpolated into raw SQL or used to pick a
   * column or a model.
   */
  args?: Record<string, any>;
}

/** Callable behind a collection-level computed attribute. */
export type CollectionComputedAttribute = (
  ctx: CollectionComputedContext,
) => any | Promise<any>;

/**
 * Extended declaration for a collection-level computed attribute that takes
 * client-supplied parameters, sent as `?attributes[name][param]=value`.
 *
 * Same detection rule as `RecordComputedAttributeSpec`: an object carrying at
 * least one of `params` / `optionalParams` / `using`, and nothing else.
 */
export interface CollectionComputedAttributeSpec {
  /** Declared parameter names, in declared order. */
  params?: string[];
  /** Declared parameters the client may omit; absent from `ctx.args` when omitted. */
  optionalParams?: string[];
  /** The callable; the bound arguments arrive on `ctx.args`. */
  using?: CollectionComputedAttribute;
}

export interface ModelRegistration {
  /** Prisma model name (camelCase or PascalCase — matches the delegate on prisma client) */
  model: string;
  policy?: Type<ResourcePolicy>;
  validation?: ZodSchema;
  validationStore?: ZodSchema | Record<string, ZodSchema>;
  validationUpdate?: ZodSchema | Record<string, ZodSchema>;
  allowedFilters?: string[];
  allowedSorts?: string[];
  defaultSort?: string;
  allowedFields?: string[];
  allowedIncludes?: string[];
  allowedSearch?: string[];
  exceptActions?: string[];
  paginationEnabled?: boolean;
  perPage?: number;
  softDeletes?: boolean;
  middleware?: Type<NestMiddleware>[];
  actionMiddleware?: Record<string, Type<NestMiddleware>[]>;
  /**
   * Indirect tenant scoping: the Prisma RELATION FIELD on this model pointing
   * at its owning model (e.g. `Task.owner: 'project'` → Prisma field
   * `project`). At boot the chain is followed through registrations (owner of
   * owner, or an explicit dot path like `'task.project'`) until one with
   * `belongsToOrganization: true`; every CRUD/resolver query is then scoped
   * with the nested filter, e.g. `{ task: { project: { organizationId } } }`.
   * `belongsToOrganization: true` on this model wins over `owner`. An
   * unresolvable value (unknown model, cycle, dead end) logs a boot warning
   * and leaves the model UNSCOPED (legacy behavior) rather than throwing.
   */
  owner?: string;
  belongsToOrganization?: boolean;
  hasAuditTrail?: boolean;
  hasUuid?: boolean;
  /**
   * Column matched against the `:id` URL segment on member endpoints
   * (show/update/destroy/restore/force-delete), e.g. `routeKey: 'hashId'`
   * → `GET /api/jobs/{hash_id}`. Falls back to the root config's `routeKey`,
   * then `'id'`. When the resolved key is not `'id'` the param is treated as
   * a string (never coerced to a number). Affects ONLY the URL-segment
   * lookup — nested operations and FK validation stay primary-key based.
   */
  routeKey?: string;
  additionalHiddenColumns?: string[];
  auditExclude?: string[];
  computedAttributes?: (record: any, user: any) => Record<string, any>;
  /**
   * OPT-IN record-level computed attributes. Unlike `computedAttributes`,
   * nothing here is evaluated unless the client names it in
   * `?computed_attributes=a,b` on index/show/trashed — so expensive per-row
   * work is only paid for when it is actually wanted. Merged before policy
   * filtering, so `hiddenAttributesForShow()` / `permittedAttributesForShow()`
   * still govern them.
   *
   * An attribute may declare PARAMETERS the client supplies as
   * `?computed_attributes[name][param]=value` — use the extended form, an
   * object carrying `params` (and optionally `optionalParams` and `using`):
   *
   *   ticketsSince: {
   *     params: ['since'],
   *     using: (record, user, args) => countSince(record, args!.since),
   *   }
   *
   * Any other value (a function, a scalar, an array) keeps its current meaning.
   */
  recordComputedAttributes?: Record<
    string,
    RecordComputedAttribute | RecordComputedAttributeSpec | any
  >;
  /**
   * COLLECTION-level computed attributes, served by
   * `GET /api/{resource}/computed?attributes=a,b`. Each entry is evaluated
   * ONCE for the whole collection — not once per row — which is what makes
   * aggregates such as `activeUsersCount` cheap.
   *
   * `ctx.where` is the fully scoped Prisma filter (organization scope, model
   * scopes, `?scope=`, `?filter[]=` and `?search=` already applied), and
   * `ctx.delegate` is the Prisma delegate for the model, so the usual shape is
   * `ctx.delegate.count({ where: { ...ctx.where, status: 'active' } })`.
   *
   * Declaring at least one attribute here is what makes the `/computed` route
   * respond for the model.
   *
   * An attribute may declare PARAMETERS the client supplies as
   * `?attributes[name][param]=value` — use the extended form, an object
   * carrying `params` (and optionally `optionalParams` and `using`):
   *
   *   revenue: {
   *     params: ['from', 'to'],
   *     using: (ctx) => ctx.delegate.aggregate({
   *       where: { ...ctx.where, createdAt: { gte: ctx.args!.from, lte: ctx.args!.to } },
   *       _sum: { total: true },
   *     }),
   *   }
   *
   * An attribute with a REQUIRED parameter is skipped by a bare
   * `GET /computed` rather than 403'd, so adding one never breaks a client that
   * asks for everything.
   */
  collectionComputedAttributes?: Record<
    string,
    CollectionComputedAttribute | CollectionComputedAttributeSpec | any
  >;
  scopes?: Type<any>[];
  /**
   * Client-selectable named scopes for ?scope=<key>. Only declared keys are
   * callable. Each scope returns a Prisma where-fragment that Rhino ANDs into
   * the query for index/trashed only.
   *
   * A scope may declare parameters the client fills in, as statics on the class:
   *
   *   class WindowScope implements RhinoNamedScope {
   *     static params = ['from', 'to'];
   *     static optionalParams = ['to'];
   *     apply(ctx: ScopeContext) { ... ctx.args.from ... }
   *   }
   *
   * Queries:
   *   GET /api/routes?scope=archived
   *   GET /api/routes?scope[since]=2026-01-01
   *   GET /api/routes?scope[window][from]=a&scope[window][to]=b
   *
   * Up to three scopes may be combined in the bracket form, applied in the
   * order the URL lists them. A scope that declares no parameters never
   * receives client input: sending any is a 403.
   */
  namedScopes?: Record<string, Type<RhinoNamedScope>>;
  /** Key of namedScopes applied when no ?scope param is sent. */
  defaultScope?: string;
  /** Foreign-key constraints to verify against the current organization. */
  fkConstraints?: Array<{ field: string; model: string }>;
}

/**
 * Context handed to every lifecycle hook. `routeGroup` is the resolved group
 * name (or `null`/`undefined` for the legacy/global auth path), `organization`
 * is present only for tenant groups, `token` is the just-issued JWT for
 * token-issuing actions (login/register), and `request` is the raw request.
 */
export interface AuthHookContext {
  user: any;
  routeGroup?: string | null;
  organization?: any;
  token?: string;
  request?: any;
}

/**
 * Per-group lifecycle hooks. Each method runs AFTER the corresponding auth
 * action succeeds. A method may reject by throwing `RhinoAuthRejected` (or any
 * error) — for token-issuing actions the controller revokes the issued token
 * and returns the rejection's status (default 403). All methods are optional;
 * an absent method is a no-op. Implementations are registered per group via
 * `RouteGroupConfig.hooks` and resolved from the Nest DI container.
 */
export interface AuthLifecycleHooks {
  afterLogin?(ctx: AuthHookContext): void | Promise<void>;
  afterLogout?(ctx: AuthHookContext): void | Promise<void>;
  afterRegister?(ctx: AuthHookContext): void | Promise<void>;
  afterPasswordRecover?(ctx: AuthHookContext): void | Promise<void>;
  afterPasswordReset?(ctx: AuthHookContext): void | Promise<void>;
}

export interface RouteGroupConfig {
  prefix?: string;
  /**
   * Constrain this group to a specific host. Two groups can then share the
   * same URL prefix and be selected by host.
   *
   *   - Omitted → the group matches any host (default; backward compatible).
   *   - Literal host, e.g. `'admin.example.com'` → requests to that host
   *     resolve to this group; requests from a non-matching host are rejected.
   *   - Parameterized host, e.g. `'{organization}.example.com'` → the captured
   *     `{organization}` subdomain feeds organization resolution, exactly like
   *     a path-prefix tenant param. Matches Laravel's `Route::domain(...)`.
   */
  domain?: string;
  middleware?: Type<NestMiddleware>[];
  /** '*' = all registered models, array = subset by slug */
  models: '*' | string[];
  /** Skip the default JWT guard for this group (for public routes) */
  skipAuth?: boolean;
  /**
   * Register the full auth route set (login/logout/password/register) for this
   * group, tagged with the group's name (Decision 9.A). The legacy unprefixed
   * `/auth/*` set always remains for the default/global path. Opt-in; default
   * `false`. The `public` group is never auth-enabled.
   */
  auth?: boolean;
  /**
   * Optional per-group lifecycle hooks. A class (resolved via Nest DI) or a
   * plain object implementing {@link AuthLifecycleHooks}. Runs after each auth
   * action for requests resolved to this group; may reject to revoke the token.
   */
  hooks?: Type<AuthLifecycleHooks> | AuthLifecycleHooks;
  /**
   * Whether this group is org-scoped (a tenant group). Tenant-group membership
   * rows require an organization; non-tenant groups (e.g. `admin`, `driver`)
   * store a NULL org. When omitted, a group is treated as a tenant group iff
   * multi-tenancy is enabled. Set `tenant: false` for org-less groups even when
   * multi-tenancy is on.
   *
   * `tenant: false` also tells the resource-scope resolver
   * (`ResourceScopeService`) that queries made in this group legitimately span
   * every organization: it applies no organization filter and does not throw
   * TENANT_CONTEXT_REQUIRED for an org-scoped model, leaving access to the
   * model's own `scopes`. Only an explicit `false` opts out — every other group
   * keeps failing closed — and an explicit `ctx.organization` still scopes.
   */
  tenant?: boolean;
}

export interface MultiTenantConfig {
  enabled?: boolean;
  organizationIdentifierColumn?: 'id' | 'slug' | 'uuid' | string;
  organizationModel?: string;
  userOrganizationModel?: string;
}

export interface NestedConfig {
  path?: string;
  maxOperations?: number;
  allowedModels?: string[] | null;
}

export interface InvitationConfig {
  expiresDays?: number;
  allowedRoles?: string[] | null;
  notificationHandler?: (invitation: any) => Promise<void> | void;
}

export interface AuthConfig {
  jwtSecret?: string;
  jwtExpiresIn?: string;
  userModel?: string;
  passwordField?: string;
  emailField?: string;
  /**
   * Master flag (default `false`) gating group-membership enforcement. When
   * off, behavior is byte-for-byte unchanged: no membership check, permissions
   * resolve from the org-presence heuristic. When on, an authenticated user
   * must hold a `user_roles` membership row matching the request's
   * `route_group` (a NULL row is a wildcard — Decision 9.B) and, for tenant
   * groups, the resolved org; no match → 403 (Decision 9.C). Permissions then
   * resolve from the matched row.
   */
  enforceGroupMembership?: boolean;
}

export interface PostmanConfig {
  roleModel?: string;
  userRoleModel?: string;
  userModel?: string;
}

export interface RhinoConfig {
  /**
   * The consuming app's PrismaClient instance. Optional at the interface level
   * so tests can construct a config without Prisma, but `RhinoModule.forRoot`
   * expects it in production use.
   */
  prismaClient?: PrismaClientLike;
  models: Record<string, ModelRegistration>;
  /**
   * Global default for {@link ModelRegistration.routeKey}. A model without its
   * own `routeKey` uses this; when neither is set the primary key `'id'` is
   * used (byte-identical to previous behavior).
   */
  routeKey?: string;
  /**
   * How many client-selectable named scopes one request may combine with the
   * bracket form (`?scope[a]=&scope[b][x]=1`). Each scope is an arbitrary
   * where-fragment that may add relation filters of its own, so the number is
   * capped: a request over the cap is refused with 403 `Too many scopes
   * requested`. Defaults to 3 — a base scope, a window, and one more predicate.
   * A non-positive value falls back to the default.
   */
  maxScopesPerRequest?: number;
  routeGroups?: Record<string, RouteGroupConfig>;
  multiTenant?: MultiTenantConfig;
  nested?: NestedConfig;
  invitations?: InvitationConfig;
  auth?: AuthConfig;
  postman?: PostmanConfig;
  clientPath?: string;
  mobilePath?: string;
  testFramework?: 'jest' | 'vitest';
}

export interface RhinoModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => Promise<RhinoConfig> | RhinoConfig;
  /**
   * Middleware classes referenced in `models[*].middleware` / `actionMiddleware`.
   * NestJS requires providers be declared synchronously, so for async config
   * the user must list them here to enable auto-wiring.
   */
  middleware?: Type<NestMiddleware>[];
}
