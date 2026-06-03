/**
 * Domain pattern matching for route-group `domain` constraints.
 *
 * A route group's `domain` can be:
 *   - a literal host, e.g. `admin.example.com` (exact, case-insensitive match)
 *   - a parameterized host, e.g. `{organization}.example.com`, where the
 *     `{name}` segment is captured and exposed so that organization resolution
 *     can use it (subdomain multitenancy).
 *
 * Mirrors Laravel's `Route::domain(...)`, where a `{param}` in the domain is
 * exposed as a route parameter that flows into ResolveOrganizationFromRoute.
 */

export interface CompiledDomain {
  /** The raw pattern (as configured). */
  pattern: string;
  /** Whether the pattern contains at least one `{param}` placeholder. */
  parameterized: boolean;
  /** Ordered list of parameter names captured by the pattern. */
  params: string[];
  /** Anchored, case-insensitive regex used to test a host. */
  regex: RegExp;
}

const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a `domain` pattern into a matcher. Returns `null` for an empty /
 * missing pattern (meaning "match any host").
 */
export function compileDomain(pattern: string | undefined | null): CompiledDomain | null {
  if (pattern == null) return null;
  const trimmed = String(pattern).trim();
  if (trimmed === '') return null;

  const params: string[] = [];
  let lastIndex = 0;
  let source = '';
  PARAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAM_RE.exec(trimmed)) !== null) {
    // literal text before the placeholder
    source += escapeRegex(trimmed.slice(lastIndex, m.index));
    const name = m[1];
    params.push(name);
    // a host label cannot contain a dot — capture a single label segment
    source += `(?<${name}>[^.]+)`;
    lastIndex = m.index + m[0].length;
  }
  source += escapeRegex(trimmed.slice(lastIndex));

  return {
    pattern: trimmed,
    parameterized: params.length > 0,
    params,
    regex: new RegExp(`^${source}$`, 'i'),
  };
}

export interface DomainMatch {
  /** Captured `{param}` values keyed by name (empty for literal domains). */
  params: Record<string, string>;
}

/**
 * Test a host against a compiled domain pattern. Returns the captured params
 * on success, or `null` when the host does not match.
 */
export function matchDomain(compiled: CompiledDomain, host: string | undefined | null): DomainMatch | null {
  if (host == null) return null;
  // Strip an optional port (Express `req.hostname` excludes it, but be safe).
  const cleaned = String(host).split(':')[0];
  if (cleaned === '') return null;
  const result = compiled.regex.exec(cleaned);
  if (!result) return null;
  const params: Record<string, string> = {};
  if (result.groups) {
    for (const name of compiled.params) {
      const value = result.groups[name];
      if (value !== undefined) params[name] = value;
    }
  }
  return { params };
}
