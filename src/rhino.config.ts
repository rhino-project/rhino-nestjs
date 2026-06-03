import { Inject, Injectable } from '@nestjs/common';
import { RHINO_CONFIG } from './constants/tokens';
import type {
  RhinoConfig,
  ModelRegistration,
  RouteGroupConfig,
  AuthLifecycleHooks,
} from './interfaces/rhino-config.interface';
import type { Type } from '@nestjs/common';
import { validateRouteGroups } from './utils/route-group-validator';

/**
 * Injectable accessor for the consuming app's Rhino configuration.
 * Wraps the raw config object with convenience lookup methods.
 */
@Injectable()
export class RhinoConfigService {
  constructor(@Inject(RHINO_CONFIG) private readonly config: RhinoConfig) {}

  raw(): RhinoConfig {
    return this.config;
  }

  models(): Record<string, ModelRegistration> {
    return this.config.models ?? {};
  }

  model(slug: string): ModelRegistration | undefined {
    return this.config.models?.[slug];
  }

  hasModel(slug: string): boolean {
    return Boolean(this.config.models?.[slug]);
  }

  routeGroups(): Record<string, RouteGroupConfig> {
    return this.config.routeGroups ?? {};
  }

  routeGroup(name: string): RouteGroupConfig | undefined {
    return this.config.routeGroups?.[name];
  }

  /**
   * Get all model slugs registered inside a route group.
   * `'*'` expands to every registered model.
   */
  modelsInRouteGroup(name: string): string[] {
    const group = this.routeGroup(name);
    if (!group) return [];
    if (group.models === '*') return Object.keys(this.models());
    return group.models;
  }

  /**
   * Master flag for group-membership enforcement (Decision 9.A/B/C). Default
   * `false` → behavior unchanged.
   */
  enforceGroupMembership(): boolean {
    return this.config.auth?.enforceGroupMembership === true;
  }

  /** Whether a group has opted into per-group auth routes (Decision 9.A). */
  routeGroupAuthEnabled(name: string | null | undefined): boolean {
    if (!name) return false;
    return this.routeGroup(name)?.auth === true;
  }

  /** The configured lifecycle-hooks provider/object for a group, if any. */
  routeGroupHooks(
    name: string | null | undefined,
  ): Type<AuthLifecycleHooks> | AuthLifecycleHooks | undefined {
    if (!name) return undefined;
    return this.routeGroup(name)?.hooks;
  }

  /** Names of all groups with `auth: true` (excludes the `public` group). */
  authEnabledGroups(): string[] {
    return Object.entries(this.routeGroups())
      .filter(([name, g]) => g.auth === true && name !== 'public')
      .map(([name]) => name);
  }

  /**
   * Whether a route group is a tenant (org-scoped) group. A group is a tenant
   * group when multi-tenancy is enabled AND the group does not opt out via
   * `belongsToOrganization: false`-style config; here we treat a group as a
   * tenant group when its declared models include any org-scoped model, or when
   * the group carries a tenant `domain`/`prefix` param. Conservatively: a group
   * is non-tenant only when explicitly marked. For membership purposes the org
   * is only required when the request actually resolved an organization, so the
   * effective rule is "tenant group ⇒ org must match". We expose the simpler
   * predicate: multi-tenant enabled and not the public group.
   */
  isTenantGroup(name: string | null | undefined): boolean {
    if (name === 'public') return false;
    if (name) {
      const group = this.routeGroup(name);
      // Explicit per-group override wins.
      if (group && typeof group.tenant === 'boolean') return group.tenant;
    }
    // Default: a group is org-scoped iff multi-tenancy is enabled.
    return this.multiTenantEnabled();
  }

  multiTenantEnabled(): boolean {
    const mt = this.config.multiTenant;
    if (!mt) return false;
    if (mt.enabled === false) return false;
    return Boolean(mt.organizationIdentifierColumn) || mt.enabled === true;
  }

  organizationIdentifierColumn(): string {
    return this.config.multiTenant?.organizationIdentifierColumn ?? 'id';
  }

  nestedConfig() {
    return {
      path: this.config.nested?.path ?? 'nested',
      maxOperations: this.config.nested?.maxOperations ?? 50,
      allowedModels: this.config.nested?.allowedModels ?? null,
    };
  }

  invitationsConfig() {
    return {
      expiresDays: this.config.invitations?.expiresDays ?? 7,
      allowedRoles: this.config.invitations?.allowedRoles ?? null,
      notificationHandler: this.config.invitations?.notificationHandler,
    };
  }

  authConfig() {
    return {
      jwtSecret:
        this.config.auth?.jwtSecret ??
        process.env.JWT_SECRET ??
        'change-me-in-production',
      jwtExpiresIn: this.config.auth?.jwtExpiresIn ?? '7d',
      userModel: this.config.auth?.userModel ?? 'user',
      emailField: this.config.auth?.emailField ?? 'email',
      passwordField: this.config.auth?.passwordField ?? 'password',
      enforceGroupMembership: this.config.auth?.enforceGroupMembership === true,
    };
  }
}

/**
 * Normalize a raw config value (defaults applied) — used by the module in forRoot.
 */
export function normalizeConfig(config: RhinoConfig): RhinoConfig {
  const normalized: RhinoConfig = {
    ...config,
    models: config.models ?? {},
    routeGroups: config.routeGroups ?? {},
    multiTenant: config.multiTenant ?? { enabled: false },
    nested: {
      path: 'nested',
      maxOperations: 50,
      allowedModels: null,
      ...(config.nested ?? {}),
    },
    invitations: {
      expiresDays: 7,
      allowedRoles: null,
      ...(config.invitations ?? {}),
    },
    auth: {
      jwtExpiresIn: '7d',
      userModel: 'user',
      emailField: 'email',
      passwordField: 'password',
      enforceGroupMembership: false,
      ...(config.auth ?? {}),
    },
  };

  // Fail fast on route groups that would silently shadow each other (same
  // prefix + intersecting host-set + overlapping models).
  validateRouteGroups(normalized);

  return normalized;
}
