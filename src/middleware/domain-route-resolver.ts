import type { Request, Response, NextFunction } from 'express';
import type { RhinoConfig, RouteGroupConfig } from '../interfaces/rhino-config.interface';
import type { PrismaClientLike } from '../prisma/prisma.service';
import { compileDomain, matchDomain, type CompiledDomain } from '../utils/domain-pattern';

export interface DomainRouteResolverOptions {
  /**
   * When `true` (default), a request whose host matches a parameterized
   * domain group but whose captured subdomain resolves to no known
   * organization → HTTP 404. When `false`, the request passes through
   * unchanged (org simply isn't attached).
   */
  strict?: boolean;
  /**
   * When `true` (default), after resolving the org the resolver verifies the
   * authenticated user (if any) is a member. Non-members → 404 (matches the
   * tenant-route-rewrite contract: cross-tenant = "not found", no
   * enumeration). When `req.user` is absent the check is skipped (auth runs
   * later).
   */
  enforceMembership?: boolean;
}

interface CompiledGroup {
  name: string;
  group: RouteGroupConfig;
  compiled: CompiledDomain;
}

/**
 * Factory for an Express-level middleware that implements host-based route
 * group resolution — the subdomain-multitenancy analogue of
 * `createTenantRouteRewrite`.
 *
 * Context: NestJS serves every model through a single GlobalController, and a
 * route group is resolved at request time. For a parameterized domain group
 * (`{organization}.example.com`), the captured subdomain must be turned into a
 * resolved `req.organization` BEFORE the controller runs — exactly like the
 * path-based `/api/<slug>/...` rewrite does for the `:organization` prefix.
 *
 * Behavior:
 *
 *   1. For each route group with a `domain`, compile its pattern.
 *   2. On each request, match `req.hostname` against those patterns.
 *      - No domain group matches → next() (plain prefix routing applies).
 *   3. When a parameterized domain group matches, take the captured
 *      `{organization}` (or `{org}`) subdomain and:
 *        - expose it on `req.params.organization`,
 *        - resolve the org by `organizationIdentifierColumn` (cached),
 *          strict-404 when unknown,
 *        - enforce membership when `req.user` is present,
 *        - attach `req.organization`.
 *      A literal domain group matches but captures no params, so it only marks
 *      the host as recognized (no org resolution).
 *
 * Intended for raw Express `app.use(createDomainRouteResolver(...))` BEFORE
 * `applyRhinoRouting(...)`, alongside / instead of `createTenantRouteRewrite`.
 */
export function createDomainRouteResolver(args: {
  prisma: PrismaClientLike;
  config: RhinoConfig;
  options?: DomainRouteResolverOptions;
}) {
  const { strict = true, enforceMembership = true } = args.options ?? {};

  const orgModel = args.config.multiTenant?.organizationModel ?? 'organization';
  const userOrgModel = args.config.multiTenant?.userOrganizationModel ?? 'userRole';
  const idColumn = args.config.multiTenant?.organizationIdentifierColumn ?? 'slug';

  const compiledGroups: CompiledGroup[] = [];
  for (const [name, group] of Object.entries(args.config.routeGroups ?? {})) {
    const compiled = compileDomain(group.domain);
    if (compiled) compiledGroups.push({ name, group, compiled });
  }

  // Cache org lookups by captured subdomain value. `null` = probed, not found.
  const cache = new Map<string, any>();

  const notFound = (res: Response) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Organization not found' });
  };

  return async function domainRouteResolver(req: Request, res: Response, next: NextFunction) {
    if (compiledGroups.length === 0) return next();
    try {
      const host = resolveHost(req);
      if (!host) return next();

      let matched: { group: CompiledGroup; params: Record<string, string> } | null = null;
      for (const cg of compiledGroups) {
        const result = matchDomain(cg.compiled, host);
        if (result) {
          matched = { group: cg, params: result.params };
          break;
        }
      }
      if (!matched) return next();

      // Mark which group the host resolved to (parity with RouteGroupMiddleware).
      (req as any).__routeGroup = matched.group.name;
      if (matched.group.group.skipAuth) (req as any).__skipAuth = true;

      const rawSubdomain = matched.params.organization ?? matched.params.org;
      if (rawSubdomain == null) {
        // Literal domain group — no tenant to resolve.
        return next();
      }
      // DNS hostnames are case-insensitive; orgs are slugged lowercase. Normalize
      // the captured subdomain before the lookup, the cache key, and the param so
      // `ACME.example.com` resolves the `acme` org consistently.
      const subdomain = rawSubdomain.toLowerCase();

      // Expose the captured subdomain like a path param.
      (req as any).params = (req as any).params ?? {};
      if ((req as any).params.organization == null) {
        (req as any).params.organization = subdomain;
      }

      // Resolve the org from the subdomain (cached).
      if (!cache.has(subdomain)) {
        const delegate =
          (args.prisma as any)[camel(orgModel)] ?? (args.prisma as any)[orgModel];
        if (!delegate?.findFirst) {
          // No org delegate — can't resolve. Pass through.
          return next();
        }
        const org = await delegate
          .findFirst({ where: { [idColumn]: subdomain } })
          .catch(() => null);
        cache.set(subdomain, org ?? null);
      }
      const org = cache.get(subdomain);
      if (!org) {
        if (strict) return notFound(res);
        return next();
      }

      // Membership check (cross-tenant → 404, not 403).
      if (enforceMembership && (req as any).user) {
        const userId = (req as any).user.id;
        const urDelegate =
          (args.prisma as any)[camel(userOrgModel)] ?? (args.prisma as any)[userOrgModel];
        if (urDelegate?.findFirst) {
          const member = await urDelegate
            .findFirst({ where: { userId, organizationId: org.id } })
            .catch(() => null);
          if (!member) return notFound(res);
        }
      }

      (req as any).organization = org;
      (req as any).__orgSubdomain = subdomain;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function resolveHost(req: Request): string | undefined {
  const fromExpress = (req as any).hostname;
  if (fromExpress) return String(fromExpress).split(':')[0];
  const header = (req.headers?.host as string | undefined) ?? (req as any).host;
  return header ? String(header).split(':')[0] : undefined;
}

function camel(name: string): string {
  if (!name) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}
