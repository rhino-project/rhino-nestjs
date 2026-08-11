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
  /**
   * slug → relation path to the org-scoped root for indirect-tenant models
   * (`owner` chains), resolved ONCE at boot. `null` = no chain (direct
   * `belongsToOrganization`, no `owner`, or an unresolvable chain — the latter
   * warns at boot and keeps the model unscoped, matching the pre-`owner`
   * behavior instead of bricking the app).
   */
  private readonly orgPaths: Map<string, string[] | null>;

  constructor(@Inject(RHINO_CONFIG) private readonly config: RhinoConfig) {
    this.orgPaths = resolveOwnerOrgPaths(this.models());
  }

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

  /**
   * Relation path from an indirect-tenant model (`owner` chain) to its
   * org-scoped root, e.g. `['task', 'project']` for
   * comments → task → project(belongsToOrganization). `null` when the model is
   * directly org-scoped, has no `owner`, or its chain could not be resolved
   * (warned at boot). Consumers build the nested Prisma filter from this path:
   * `{ task: { project: { organizationId } } }`.
   */
  orgPathFor(slug: string): string[] | null {
    return this.orgPaths.get(slug) ?? null;
  }

  /** Global default route key (root `routeKey`), `'id'` when unset. */
  globalRouteKey(): string {
    return this.config.routeKey ?? 'id';
  }

  /**
   * Column matched against the `:id` URL segment for a model's member
   * endpoints. Resolution: `models[slug].routeKey ?? config.routeKey ?? 'id'`.
   */
  routeKeyFor(slug: string): string {
    return this.model(slug)?.routeKey ?? this.globalRouteKey();
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

/** Max hops when following an `owner` chain to the org-scoped root. */
const OWNER_CHAIN_MAX_DEPTH = 10;

/** Split a (possibly dot-notated) `owner` value into relation segments. */
function ownerSegments(owner: unknown): string[] {
  if (typeof owner !== 'string') return [];
  return owner
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Find the registered model an `owner` segment points at. The segment is the
 * Prisma RELATION FIELD NAME on the child model (e.g. `Task.owner: 'project'`
 * → Prisma relation field `project`). Matching order:
 *
 *   1. Prisma model name, case-insensitive (`'project'` → model `'Project'`).
 *   2. Registration slug, case-insensitive, with naive pluralization
 *      (`project` → `projects`, `category` → `categories`, `box` → `boxes`).
 *   3. The same two lookups with a trailing `Id`/`_id` stripped, for legacy
 *      configs that stored the FK column (`'userId'`) instead of the relation.
 *
 * Returns the matched slug plus the relation field name to use in the Prisma
 * path (the raw segment, or the stripped form when an `Id` suffix matched).
 */
function findOwnedRegistration(
  segment: string,
  models: Record<string, ModelRegistration>,
): { slug: string; relation: string } | null {
  const bySlugOrModel = (name: string): string | null => {
    const lower = name.toLowerCase();
    for (const [slug, reg] of Object.entries(models)) {
      if (String(reg.model).toLowerCase() === lower) return slug;
    }
    const slugCandidates = [
      lower,
      `${lower}s`,
      lower.endsWith('y') ? `${lower.slice(0, -1)}ies` : null,
      `${lower}es`,
    ].filter((c): c is string => c != null);
    for (const candidate of slugCandidates) {
      for (const slug of Object.keys(models)) {
        if (slug.toLowerCase() === candidate) return slug;
      }
    }
    return null;
  };

  const direct = bySlugOrModel(segment);
  if (direct) return { slug: direct, relation: segment };

  // Legacy FK-column form: `userId` / `user_id` → relation `user`.
  const stripped = segment.replace(/_?[iI]d$/, '');
  if (stripped && stripped !== segment) {
    const viaFk = bySlugOrModel(stripped);
    if (viaFk) return { slug: viaFk, relation: stripped };
  }
  return null;
}

/**
 * Resolve, for every registration with an `owner` chain, the relation path to
 * its org-scoped root. Runs once at boot (RhinoConfigService construction).
 *
 * Failure policy: `owner` was previously inert at runtime, so a stale value
 * must NOT throw — an unknown owner, a cycle, or a chain that never reaches a
 * `belongsToOrganization` registration logs a console.warn and leaves the
 * model unscoped (today's behavior). `belongsToOrganization: true` on the
 * model itself wins over `owner` (direct scoping, no path, no warning).
 */
export function resolveOwnerOrgPaths(
  models: Record<string, ModelRegistration>,
): Map<string, string[] | null> {
  const warn = (slug: string, reason: string) =>
    // eslint-disable-next-line no-console
    console.warn(
      `[Rhino] Model '${slug}': owner chain could not be resolved (${reason}). ` +
        `The model will NOT be organization-scoped — records are visible across tenants. ` +
        `Fix the 'owner' value (the Prisma relation field pointing at the owning model) to enable scoping.`,
    );

  const resolve = (slug: string): string[] | null => {
    const path: string[] = [];
    const visited = new Set<string>([slug]);
    let segments = ownerSegments(models[slug].owner);
    let currentSlug = slug;
    for (let depth = 0; depth < OWNER_CHAIN_MAX_DEPTH; depth++) {
      const segment = segments.shift();
      if (segment === undefined) {
        warn(
          slug,
          `chain dead-ends at '${currentSlug}', which neither belongs to an organization nor declares an owner`,
        );
        return null;
      }
      const owned = findOwnedRegistration(segment, models);
      if (!owned) {
        warn(slug, `owner '${segment}' does not name a registered model`);
        return null;
      }
      path.push(owned.relation);
      const ownedReg = models[owned.slug];
      if (ownedReg.belongsToOrganization) return path;
      if (visited.has(owned.slug)) {
        warn(slug, `cycle detected at '${owned.slug}'`);
        return null;
      }
      visited.add(owned.slug);
      currentSlug = owned.slug;
      if (segments.length === 0) segments = ownerSegments(ownedReg.owner);
    }
    warn(slug, `chain exceeds the maximum depth of ${OWNER_CHAIN_MAX_DEPTH}`);
    return null;
  };

  const out = new Map<string, string[] | null>();
  for (const [slug, reg] of Object.entries(models)) {
    if (!reg.owner || reg.belongsToOrganization) {
      out.set(slug, null);
      continue;
    }
    out.set(slug, resolve(slug));
  }
  return out;
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

  // Fail fast on an invalid route key: any provided `routeKey` (global or
  // per-model) must be a non-empty string. A blank/typoed key would silently
  // break every member endpoint, so this is a boot error.
  const validateRouteKey = (value: unknown, where: string) => {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `${where}: routeKey must be a non-empty string (e.g. 'hashId'); got ${JSON.stringify(value)}.`,
      );
    }
  };
  validateRouteKey(normalized.routeKey, 'Rhino config');
  for (const [slug, reg] of Object.entries(normalized.models)) {
    validateRouteKey(reg.routeKey, `Model '${slug}'`);
  }

  // Fail fast on a model whose defaultScope is not an own key of its
  // namedScopes — a misconfigured default must never silently fall through to
  // an unscoped listing.
  for (const [slug, reg] of Object.entries(normalized.models)) {
    if (reg.defaultScope == null) continue;
    if (
      !reg.namedScopes ||
      !Object.prototype.hasOwnProperty.call(reg.namedScopes, reg.defaultScope)
    ) {
      throw new Error(
        `Model '${slug}': defaultScope '${reg.defaultScope}' is not a declared key of namedScopes.`,
      );
    }
  }

  // Fail fast on route groups that would silently shadow each other (same
  // prefix + intersecting host-set + overlapping models).
  validateRouteGroups(normalized);

  return normalized;
}
