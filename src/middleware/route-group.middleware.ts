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

    // FIX 11.1 (auth-path resolution): an auth entry path (login/logout/
    // register/password recover|reset) must resolve to the auth-enabled group
    // that matches this host/prefix, falling back to the empty-prefix/default
    // group, and must ALWAYS keep `__skipAuth` so the JWT guard never blocks
    // login/register/recover. A host-claiming empty-prefix DOMAIN group (which
    // matches every path) must NOT win the auth path away from the group it
    // belongs to. This branch is a no-op for apps with no auth-enabled group.
    if (this.isAuthEntryPath(url) && this.config.authEnabledGroups().length > 0) {
      this.resolveAuthEntry(req, url, host, groups);
      return next();
    }

    // NOTE: never mutate `req.__skipAuth` inside this loop. Candidate matches
    // record their group's `skipAuth` flag and the winning match applies it
    // exactly once below, so a losing prefix group can't leak skipAuth onto a
    // domain group that wins precedence (BLOCKER 1).
    let prefixMatch: { name: string; prefix: string; skipAuth?: boolean } | null = null;
    let domainMatch:
      | { name: string; prefix: string; params: Record<string, string>; skipAuth?: boolean }
      | null = null;
    // The empty-prefix, non-domain "default" group (e.g. `default`), if any. It
    // serves every path that no more-specific prefix/domain group claims, so it
    // is the fallback `__routeGroup` — making enforcement uniform: even the
    // default group tags its routes with the group name (parity with
    // Laravel/Rails). Without this, a null request-group matched ANY membership
    // row (the route_group dimension was ignored). See FIX 3.
    let defaultMatch: { name: string; prefix: string; skipAuth?: boolean } | null = null;
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
        // becomes the `__routeGroup` only as a FALLBACK (below) — a concrete
        // prefix or domain group always wins. Recording it lets the default
        // group tag its routes with the group name so membership enforcement
        // is uniform across all groups (FIX 3).
        nonDomainEligible = true;
        if (!defaultMatch) {
          defaultMatch = { name, prefix, skipAuth: group.skipAuth };
        }
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

    // Fallback: an empty-prefix, non-domain "default" group serves whatever no
    // concrete prefix/domain group claimed. Tag the request with its name so
    // the default group is a first-class membership dimension (FIX 3). A
    // wrong-host domain group must not pre-empt a request this group can serve,
    // so this also resolves the blockedByHost case below.
    if (defaultMatch) {
      req.__routeGroup = defaultMatch.name;
      if (defaultMatch.skipAuth) req.__skipAuth = true;
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

  /**
   * Whether `url` targets one of the auth entry endpoints. These are the
   * routes that must never be blocked by the JWT guard (login/register/recover)
   * and that must resolve to the group they belong to. Matches the auth
   * controller's `@Controller('auth')` action paths under any prefix.
   */
  private isAuthEntryPath(url: string): boolean {
    return (
      /(^|\/)auth\/login(\/|$)/.test(url) ||
      /(^|\/)auth\/logout(\/|$)/.test(url) ||
      /(^|\/)auth\/register(\/|$)/.test(url) ||
      /(^|\/)auth\/password\/[^/]+(\/|$)/.test(url)
    );
  }

  /**
   * Resolve the route group for an auth entry path (FIX 11.1). Precedence:
   *   1. an auth-enabled DOMAIN group whose host matches (and prefix matches);
   *   2. an auth-enabled PREFIX group whose prefix matches;
   *   3. the empty-prefix / default group (auth-enabled preferred, else any);
   *   4. otherwise leave `__routeGroup` unset (legacy/global auth path).
   *
   * `__skipAuth` is ALWAYS set on an auth entry path so the JWT guard never
   * blocks login/register/recover, regardless of which group wins — even a
   * host-claiming empty-prefix domain group cannot strip it.
   */
  private resolveAuthEntry(
    req: Request & Record<string, any>,
    url: string,
    host: string | undefined,
    groups: Record<string, { prefix?: string; domain?: string; auth?: boolean; skipAuth?: boolean }>,
  ): void {
    let authDomain: { name: string; params: Record<string, string> } | null = null;
    let authPrefix: { name: string; prefixLen: number } | null = null;
    let authDefault: string | null = null;
    let plainDefault: string | null = null;

    for (const [name, group] of Object.entries(groups)) {
      const prefix = group.prefix ?? '';
      if (prefix.startsWith(':')) continue; // dynamic tenant prefix
      const authEnabled = group.auth === true && name !== 'public';
      const compiled = this.compileFor(name, group.domain);

      if (compiled) {
        if (!authEnabled) continue;
        const hostResult = matchDomain(compiled, host);
        if (!hostResult) continue;
        if (!this.prefixMatches(url, prefix)) continue;
        if (!authDomain) authDomain = { name, params: hostResult.params };
        continue;
      }

      // Plain (non-domain) group.
      if (!prefix) {
        // Empty-prefix / default group: the auth-path fallback.
        if (authEnabled) {
          if (authDefault == null) authDefault = name;
        } else if (plainDefault == null) {
          plainDefault = name;
        }
        continue;
      }
      if (authEnabled && this.prefixMatches(url, prefix)) {
        // Prefer the most specific (longest) matching prefix.
        if (!authPrefix || prefix.length > authPrefix.prefixLen) {
          authPrefix = { name, prefixLen: prefix.length };
        }
      }
    }

    // Auth entry paths are always exempt from the JWT guard.
    req.__skipAuth = true;

    if (authDomain) {
      req.__routeGroup = authDomain.name;
      this.exposeDomainParams(req, authDomain.params);
      return;
    }
    if (authPrefix) {
      req.__routeGroup = authPrefix.name;
      return;
    }
    // Fall back to the default group: an auth-enabled empty-prefix group is the
    // legacy/global auth path itself (design §11.1), so it adopts the auth
    // route. If none is auth-enabled, use any empty-prefix default group so the
    // request still carries a first-class group (parity with FIX 3).
    const fallback = authDefault ?? plainDefault;
    if (fallback) req.__routeGroup = fallback;
    // else: no group claims it → legacy/global auth path (null group).
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
