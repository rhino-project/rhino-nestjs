import type {
  RhinoConfig,
  RouteGroupConfig,
} from '../interfaces/rhino-config.interface';

/**
 * Thrown at config-normalization (boot) time when two route groups would
 * resolve to the same routes and silently shadow one another.
 *
 * This happens when two groups share the same effective prefix, have
 * intersecting host-sets (no `domain` = matches every host; identical domain
 * pattern), and register overlapping models. Failing fast prevents a dangerous
 * misconfiguration (e.g. a `skipAuth` group shadowing an authenticated one).
 */
export class RouteGroupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteGroupConflictError';
  }
}

function normalizePrefix(group: RouteGroupConfig): string {
  return String(group.prefix ?? '');
}

/** An undefined/blank domain means "any host". */
function normalizeDomain(group: RouteGroupConfig): string | null {
  const domain = group.domain;
  if (domain == null || String(domain).trim() === '') return null;
  return String(domain);
}

function hostSetsIntersect(a: RouteGroupConfig, b: RouteGroupConfig): boolean {
  const da = normalizeDomain(a);
  const db = normalizeDomain(b);
  // A wildcard host (no domain) intersects with any other host-set.
  if (da === null || db === null) return true;
  // Two explicit domain patterns intersect only when identical.
  return da === db;
}

function resolveModels(
  group: RouteGroupConfig,
  allModels: Record<string, unknown>,
): string[] {
  if (group.models === '*') return Object.keys(allModels ?? {});
  return group.models ?? [];
}

function overlappingModels(
  a: RouteGroupConfig,
  b: RouteGroupConfig,
  allModels: Record<string, unknown>,
): string[] {
  const ma = new Set(resolveModels(a, allModels));
  return resolveModels(b, allModels).filter((slug) => ma.has(slug));
}

function buildMessage(
  aName: string,
  bName: string,
  a: RouteGroupConfig,
  b: RouteGroupConfig,
  shared: string[],
): string {
  const prefix = normalizePrefix(a);
  const prefixLabel = prefix === '' ? '(root)' : `'${prefix}'`;

  const da = normalizeDomain(a);
  const db = normalizeDomain(b);
  const domainLabel =
    da === null && db === null
      ? 'no domain'
      : `domains [${da ?? 'any'}, ${db ?? 'any'}]`;

  return (
    `Route groups '${aName}' and '${bName}' conflict: they share prefix ` +
    `${prefixLabel} with ${domainLabel} and overlapping models (${shared.join(', ')}), ` +
    `so one would silently shadow the other. Give them distinct prefixes, or ` +
    `distinguish them with different 'domain' values, or make their 'models' disjoint.`
  );
}

/**
 * Validate the configured route groups and throw RouteGroupConflictError when
 * two groups would silently shadow each other.
 *
 * A route group's routing identity is the pair (host-set, prefix), per model.
 * Two groups conflict when ALL of the following hold:
 *
 *   1. Their host-sets intersect (a group with no `domain` is a wildcard host).
 *   2. They share the same effective prefix (undefined/'' is the same root).
 *   3. Their model sets overlap ('*' expands to every registered model).
 *
 * With a distinguishing domain, the prefix is optional (the host disambiguates);
 * without a domain, the prefix is the only disambiguator, so two or more
 * overlapping groups must use distinct prefixes.
 *
 * Note: conservative static check — exotic cross-pattern overlaps (a literal
 * host that also satisfies another group's `{param}.example.com`) are not
 * statically detected.
 */
export function validateRouteGroups(config: RhinoConfig): void {
  const groups = config.routeGroups ?? {};
  const models = config.models ?? {};
  const names = Object.keys(groups);

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = groups[names[i]];
      const b = groups[names[j]];

      if (!hostSetsIntersect(a, b)) continue;
      if (normalizePrefix(a) !== normalizePrefix(b)) continue;

      const shared = overlappingModels(a, b, models);
      if (shared.length === 0) continue;

      throw new RouteGroupConflictError(
        buildMessage(names[i], names[j], a, b, shared),
      );
    }
  }
}
