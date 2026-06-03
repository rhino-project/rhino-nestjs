import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RhinoConfigService } from '../rhino.config';
import { compileDomain, matchDomain, type CompiledDomain } from '../utils/domain-pattern';

/**
 * Detects which Rhino route group the current request belongs to and attaches:
 *   - `req.__routeGroup`  — the group name
 *   - `req.__skipAuth`    — true when the group has `skipAuth: true`
 *
 * Group selection considers BOTH:
 *
 *   1. **Host** — when a group declares a `domain`, it is only eligible for
 *      requests whose `req.hostname` matches that domain. A literal domain
 *      (`admin.example.com`) must match exactly; a parameterized domain
 *      (`{organization}.example.com`) captures the subdomain and exposes it as
 *      `req.params.organization` so ResolveOrganizationMiddleware can resolve
 *      the tenant from the host — mirroring Laravel's `Route::domain(...)`.
 *
 *   2. **URL prefix** — the existing path-prefix matching, unchanged for groups
 *      without a `domain`.
 *
 * Host-scoped groups take precedence over plain prefix groups when both could
 * match, so two groups can share the same prefix and be selected by host.
 *
 * Enforcement: if the request path targets a model that is ONLY served by
 * domain-scoped group(s) and the host matches none of them, the request is
 * rejected with 404 — a wrong-host request must not be served as that group.
 *
 * Install this middleware globally BEFORE `JwtAuthGuard` so the guard can read
 * `req.__skipAuth`, and BEFORE `ResolveOrganizationMiddleware` so a captured
 * subdomain param is available for org resolution.
 */
@Injectable()
export class RouteGroupMiddleware implements NestMiddleware {
  /** Cache compiled domain patterns keyed by group name. */
  private readonly compiledCache = new Map<string, CompiledDomain | null>();

  constructor(private readonly config: RhinoConfigService) {}

  private compileFor(name: string, domain: string | undefined): CompiledDomain | null {
    if (this.compiledCache.has(name)) return this.compiledCache.get(name) ?? null;
    const compiled = compileDomain(domain);
    this.compiledCache.set(name, compiled);
    return compiled;
  }

  use(req: Request & Record<string, any>, _res: Response, next: NextFunction) {
    // BP-006: `req.url` is stripped to the middleware's mount-point when
    // registered via NestModule.configure(consumer).forRoutes('*'), so it
    // collapses to `/` for every request. `req.originalUrl` carries the full
    // request URL verbatim — use that for prefix matching.
    const url = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    const host = this.resolveHost(req);
    const groups = this.config.routeGroups();

    // NOTE: never mutate `req.__skipAuth` inside this loop. Candidate matches
    // record their group's `skipAuth` flag and the winning match applies it
    // exactly once below, so a losing prefix group can't leak skipAuth onto a
    // domain group that wins precedence (BLOCKER 1).
    let prefixMatch: { name: string; prefix: string; skipAuth?: boolean } | null = null;
    let domainMatch:
      | { name: string; prefix: string; params: Record<string, string>; skipAuth?: boolean }
      | null = null;
    // Tracks whether the URL path targeted a domain-scoped group whose host did
    // NOT match — used for wrong-host 404 enforcement.
    let blockedByHost = false;
    // Tracks whether ANY non-domain group is eligible to serve this request
    // (matched its prefix, or is a catch-all empty-prefix group). An
    // empty-prefix domain group matches every path, so it must not 404 a
    // request that such a non-domain group could serve (BLOCKER 2).
    let nonDomainEligible = false;

    for (const [name, group] of Object.entries(groups)) {
      const prefix = group.prefix ?? '';
      const compiled = this.compileFor(name, group.domain);

      if (compiled) {
        // Domain-scoped group: only eligible when the host matches.
        const hostResult = matchDomain(compiled, host);
        const pathMatches = this.prefixMatches(url, prefix);
        if (!hostResult) {
          // Host doesn't match this domain group. If the path would otherwise
          // target this group, remember it for wrong-host enforcement (only
          // honored below when no other group can serve the request).
          if (pathMatches) blockedByHost = true;
          continue;
        }
        // Host matches. Require the prefix to match too (empty prefix => match).
        if (!pathMatches) continue;
        if (!domainMatch) {
          domainMatch = {
            name,
            prefix,
            params: hostResult.params,
            skipAuth: group.skipAuth,
          };
        }
        continue;
      }

      // Plain prefix group (no domain) — original behavior.
      if (prefix.startsWith(':')) continue; // dynamic tenant prefix — handled by ResolveOrganizationMiddleware
      if (!prefix) {
        // Catch-all (empty-prefix) non-domain group: eligible for any path, so
        // a wrong-host domain group must not block requests it could serve. It
        // does not itself become a __routeGroup match (preserves prior behavior).
        nonDomainEligible = true;
        continue;
      }
      if (this.prefixMatches(url, prefix)) {
        nonDomainEligible = true;
        if (!prefixMatch) {
          prefixMatch = { name, prefix, skipAuth: group.skipAuth };
        }
      }
    }

    // Host-scoped match takes precedence over a plain prefix match. Apply
    // `__skipAuth` exactly once, from the winning group only.
    if (domainMatch) {
      req.__routeGroup = domainMatch.name;
      if (domainMatch.skipAuth) req.__skipAuth = true;
      // Expose captured subdomain params (e.g. {organization}) so that
      // ResolveOrganizationMiddleware can resolve the tenant from the host.
      this.exposeDomainParams(req, domainMatch.params);
      return next();
    }

    if (prefixMatch) {
      req.__routeGroup = prefixMatch.name;
      if (prefixMatch.skipAuth) req.__skipAuth = true;
      return next();
    }

    // No group matched. If a domain-scoped group targeted by the path had a
    // non-matching host AND no non-domain group is eligible to serve the
    // request, reject: a wrong-host request must not be served as that group.
    // (An empty-prefix domain group that would block every path is overridden
    // here by any eligible non-domain group — BLOCKER 2.)
    if (blockedByHost && !nonDomainEligible) {
      return next(new NotFoundException('Not found'));
    }

    next();
  }

  private resolveHost(req: Request & Record<string, any>): string | undefined {
    // Express populates `req.hostname` (port-stripped). Fall back to the Host
    // header for environments/tests that only set headers.
    const fromExpress = (req as any).hostname;
    if (fromExpress) return String(fromExpress);
    const header = (req.headers?.host as string | undefined) ?? (req as any).host;
    return header ? String(header).split(':')[0] : undefined;
  }

  private prefixMatches(url: string, prefix: string): boolean {
    if (!prefix) return true; // empty prefix => any path under the group
    if (prefix.startsWith(':')) return false;
    return url.includes(`/${prefix}/`) || url.endsWith(`/${prefix}`);
  }

  private exposeDomainParams(
    req: Request & Record<string, any>,
    params: Record<string, string>,
  ): void {
    if (!params || Object.keys(params).length === 0) return;
    // DNS hostnames are case-insensitive but the regex capture preserves the
    // host's casing verbatim. Lowercase the captured subdomain params so org
    // resolution (and the resolver's cache key) is consistent — `ACME` and
    // `acme` must resolve the same lowercase-slugged org.
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      normalized[key] = typeof value === 'string' ? value.toLowerCase() : value;
    }
    req.params = req.params ?? ({} as any);
    for (const [key, value] of Object.entries(normalized)) {
      // Don't clobber an explicit path param of the same name.
      if ((req.params as any)[key] == null) (req.params as any)[key] = value;
    }
    // Convention: a `{organization}` (or `{org}`) domain param feeds org
    // resolution exactly like the `:organization` path param does. Surface it
    // under `organization` so ResolveOrganizationMiddleware reads it uniformly.
    const orgParam = normalized.organization ?? normalized.org;
    if (orgParam != null && (req.params as any).organization == null) {
      (req.params as any).organization = orgParam;
    }
    // Also record the (normalized) captured subdomain for downstream/debug use.
    req.__domainParams = normalized;
  }
}
