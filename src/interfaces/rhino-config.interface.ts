import type { Type } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { ResourcePolicy } from '../policies/resource-policy';
import type { PrismaClientLike } from '../prisma/prisma.service';

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
  owner?: string;
  belongsToOrganization?: boolean;
  hasAuditTrail?: boolean;
  hasUuid?: boolean;
  additionalHiddenColumns?: string[];
  auditExclude?: string[];
  computedAttributes?: (record: any, user: any) => Record<string, any>;
  scopes?: Type<any>[];
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
