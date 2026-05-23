import type { Request, Response, NextFunction } from 'express';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';
import type { PrismaClientLike } from '../prisma/prisma.service';

export interface TenantRouteRewriteOptions {
  /**
   * Global API prefix used by the consumer (matches
   * `applyRhinoRouting({ prefix })`). Defaults to `'api'`.
   */
  apiPrefix?: string;
  /**
   * Path segments to treat as non-tenant even when they match an org slug
   * (they sit at the api root). Defaults cover the library's built-in
   * public/auth endpoints plus `nested`.
   */
  reservedSegments?: string[];
  /**
   * When `true` (default), a URL that looks tenant-shaped but whose first
   * segment doesn't match any known organization → HTTP 404. When `false`
   * the request passes through unchanged (GlobalController then treats the
   * segment as a model slug and likely returns its own UNKNOWN_RESOURCE
   * 404).
   */
  strict?: boolean;
  /**
   * When `true` (default), after resolving the org the middleware checks
   * that the authenticated user (if any) is a member. Non-members produce
   * a 404 (intentional — matches Laravel "Organization not found"). If
   * `req.user` is absent the check is skipped (auth runs later).
   */
  enforceMembership?: boolean;
}

/**
 * Factory for an Express-level middleware that implements the
 * `routeGroups.tenant.prefix: ':organization'` contract promised by
 * RhinoConfig.
 *
 * Context (BP-001): NestJS controllers are declared with static
 * `@Controller(...)` paths, so the library cannot dynamically prefix them
 * with a runtime `:organization` segment. NestModule.configure() middleware
 * runs AFTER Nest has matched the handler, so a middleware registered there
 * cannot rewrite the URL in time. This factory returns a handler intended
 * for raw Express `app.use(tenantRouteRewrite(...))` BEFORE calling
 * `applyRhinoRouting(...)`.
 *
 * Behavior:
 *
 *   1. Match `/{apiPrefix}/<slug>/<rest>`. If no match → next().
 *   2. If `<slug>` is a reserved segment (auth/invitations/nested) → next().
 *   3. Look up the organization by slug (with an in-process cache).
 *      - Not found + strict → 404 CROSS_TENANT
 *      - Not found + non-strict → next() (treated as a model slug)
 *   4. When the request is authenticated, verify membership. Non-member →
 *      404 CROSS_TENANT (same code as missing org — by design, no user
 *      enumeration).
 *   5. Attach the resolved org to `req.organization` and rewrite
 *      `req.url` / `req.originalUrl` to drop the slug so the GlobalController
 *      continues to match `/{apiPrefix}/:modelSlug`.
 *
 * Usage:
 *
 *   import { createTenantRouteRewrite, RHINO_CONFIG, RHINO_PRISMA_CLIENT } from '@rhino-dev/rhino-nestjs';
 *
 *   async function bootstrap() {
 *     const app = await NestFactory.create(AppModule);
 *     const prisma = app.get(RHINO_PRISMA_CLIENT);
 *     const config = app.get(RHINO_CONFIG);
 *     app.use(createTenantRouteRewrite({ prisma, config }));
 *     applyRhinoRouting(app, { prefix: 'api' });
 *     await app.listen(8004);
 *   }
 */
export function createTenantRouteRewrite(args: {
  prisma: PrismaClientLike;
  config: RhinoConfig;
  options?: TenantRouteRewriteOptions;
}) {
  const {
    apiPrefix = 'api',
    reservedSegments = ['auth', 'invitations', 'nested'],
    strict = true,
    enforceMembership = true,
  } = args.options ?? {};

  const reserved = new Set(reservedSegments);
  const orgModel = args.config.multiTenant?.organizationModel ?? 'organization';
  const userOrgModel = args.config.multiTenant?.userOrganizationModel ?? 'userRole';
  const idColumn = args.config.multiTenant?.organizationIdentifierColumn ?? 'slug';
  const knownModelSlugs = new Set(Object.keys(args.config.models ?? {}));

  // Simple in-memory cache keyed by slug → org record.
  // `null` = probed and not found (short-circuit on subsequent calls).
  const cache = new Map<string, any>();

  const notFound = (res: Response) => {
    res.status(404).json({
      code: 'NOT_FOUND',
      message: 'Organization not found',
    });
  };

  const prefixPattern = new RegExp(`^/${escapeRegex(apiPrefix)}/([^/]+)(/.*)?$`);

  return async function tenantRouteRewrite(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = String(req.url ?? '').split('?')[0];
      const query = String(req.url ?? '').slice(raw.length);
      const m = raw.match(prefixPattern);
      if (!m) return next();

      const first = m[1];
      const rest = m[2] ?? '';

      // Reserved non-tenant segments (auth, invitations, nested) pass through.
      if (reserved.has(first)) return next();

      // If the first segment matches a KNOWN model slug, this isn't a tenant
      // route — the consumer is hitting `/api/<modelSlug>` directly (e.g.
      // without a tenant prefix). Skip rewriting.
      if (knownModelSlugs.has(first)) return next();

      // Look up org. Cache null so repeat lookups are fast.
      if (!cache.has(first)) {
        const delegate = (args.prisma as any)[camel(orgModel)] ?? (args.prisma as any)[orgModel];
        if (!delegate?.findFirst) return next();
        const org = await delegate.findFirst({ where: { [idColumn]: first } }).catch(() => null);
        cache.set(first, org ?? null);
      }
      const org = cache.get(first);
      if (!org) {
        if (strict) return notFound(res);
        return next();
      }

      // Membership check (BP-011: cross-tenant → 404, not 403).
      if (enforceMembership && (req as any).user) {
        const userId = (req as any).user.id;
        const urDelegate = (args.prisma as any)[camel(userOrgModel)] ?? (args.prisma as any)[userOrgModel];
        if (urDelegate?.findFirst) {
          const member = await urDelegate
            .findFirst({ where: { userId, organizationId: org.id } })
            .catch(() => null);
          if (!member) return notFound(res);
        }
      }

      // Attach + rewrite.
      (req as any).organization = org;
      (req as any).__orgSlug = first;
      req.url = `/${apiPrefix}${rest}${query}`;
      (req as any).originalUrl = req.url;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function camel(name: string): string {
  if (!name) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
