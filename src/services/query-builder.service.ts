import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { RhinoConfigService } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';
import { DEFAULT_MAX_SCOPES_PER_REQUEST } from '../constants/defaults';

export interface ParsedQuery {
  where: Record<string, any>;
  orderBy: any;
  include?: Record<string, any>;
  select?: Record<string, any>;
  page?: number;
  perPage?: number;
  /** Validated named-scope key to apply (index/trashed only). */
  scopeName?: string;
  /**
   * Validated named scopes to apply, in the order the URL listed them, each
   * with its bound arguments (index/trashed only).
   */
  scopes?: Array<{ name: string; args: Record<string, any> }>;
}

/** Who is asking, so the policy can gate scopes and attributes. */
export interface QueryContext {
  user?: any;
  organization?: any;
}

/**
 * Fallback for how many named scopes one request may combine, used when no
 * config is injected. Apps set the root `maxScopesPerRequest` key. Defined in
 * constants/defaults so this module and `rhino.config` do not import each other.
 */
export { DEFAULT_MAX_SCOPES_PER_REQUEST };

/**
 * Parses query string parameters into Prisma-compatible `findMany` args.
 *
 * Supported shape (match Laravel + Spatie QueryBuilder semantics):
 *   ?filter[field]=value           — AND match, comma-separated values become IN
 *   ?sort=-created_at,title        — leading `-` reverses direction
 *   ?search=term                   — fuzzy search across allowedSearch fields
 *   ?per_page=25&page=2            — pagination
 *   ?fields[slug]=id,title         — field selection (Prisma `select`)
 *   ?include=user,comments.author  — eager loading with dot-notation
 */
@Injectable()
export class QueryBuilderService {
  /**
   * Config is optional for backwards compatibility (`new QueryBuilderService()`
   * in older tests/consumers) — without it, only the per-model `routeKey`
   * is seeded into `?fields[]` selects (global default falls back to 'id').
   */
  constructor(@Optional() private readonly config?: RhinoConfigService) {}

  build(
    query: Record<string, any>,
    reg: ModelRegistration,
    opts: { namedScopes?: boolean; ctx?: QueryContext } = {},
  ): ParsedQuery {
    const ctx = opts.ctx ?? {};
    const parsed: ParsedQuery = {
      where: this.buildWhere(query, reg, ctx),
      orderBy: this.buildOrderBy(query, reg, ctx),
      include: this.buildInclude(query, reg),
      select: this.buildSelect(query, reg),
      page: this.parseInt(query.page),
      perPage: this.parseInt(query.per_page ?? query.perPage),
    };

    if (opts.namedScopes) {
      parsed.scopes = this.buildNamedScopes(query, reg, ctx);
      // Kept for consumers that read a single scope name.
      parsed.scopeName = parsed.scopes[0]?.name;
    }

    return parsed;
  }

  /**
   * Parse, authorize and bind `?scope=` / `?scope[name][param]=value`.
   *
   * Two wire forms, which cannot be mixed in one request because they share the
   * same query key:
   *
   *   ?scope=archived                      legacy, one scope, no arguments
   *   ?scope[archived]=                    same thing in the bracket form
   *   ?scope[since]=2026-01-01             one argument, bound to the single
   *                                        declared parameter
   *   ?scope[window][from]=a&scope[window][to]=b   named arguments
   *
   * A scope declares its parameters as `static params` (and `static
   * optionalParams`) on the scope class; the bound arguments reach `apply()` as
   * `context.args`. A scope that declares none never receives any.
   */
  buildNamedScopes(
    query: Record<string, any>,
    reg: ModelRegistration,
    ctx: QueryContext = {},
  ): Array<{ name: string; args: Record<string, any> }> {
    const raw = query.scope;

    // Nothing requested: the model's default scope, which takes no arguments.
    if (raw == null || raw === '' || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
      if (reg.defaultScope === undefined) return [];
      this.assertScopeDeclared(reg.defaultScope, reg);
      return [{ name: reg.defaultScope, args: {} }];
    }

    let requested: Array<[string, any]>;
    if (typeof raw === 'string') {
      // Legacy form — one scope, no arguments.
      requested = [[raw, '']];
    } else if (Array.isArray(raw) || typeof raw !== 'object') {
      // A repeated ?scope=a&scope=b or ?scope[]=a names nothing.
      throw RhinoException.forbidden(`Scope is not allowed`);
    } else {
      requested = Object.entries(raw as Record<string, any>);
    }

    if (requested.length > this.maxScopesPerRequest()) {
      throw RhinoException.forbidden('Too many scopes requested');
    }

    const permitted = this.permittedScopeNames(reg, ctx);

    return requested.map(([name, rawArgs]) => {
      if (typeof name !== 'string' || name === '') {
        throw RhinoException.forbidden(`Scope is not allowed`);
      }
      this.assertScopeDeclared(name, reg);
      if (!(permitted.length === 1 && permitted[0] === '*') && !permitted.includes(name)) {
        throw RhinoException.forbidden(`Scope '${name}' is not allowed`);
      }
      return { name, args: this.bindScopeArguments(name, reg, rawArgs) };
    });
  }

  /** How many named scopes this app allows in one request. */
  private maxScopesPerRequest(): number {
    return this.config?.maxScopesPerRequest?.() ?? DEFAULT_MAX_SCOPES_PER_REQUEST;
  }

  /** Own-key check: a prototype key such as `constructor` is never a scope. */
  private assertScopeDeclared(name: string, reg: ModelRegistration): void {
    if (
      !reg.namedScopes ||
      !Object.prototype.hasOwnProperty.call(reg.namedScopes, name) ||
      typeof reg.namedScopes[name] !== 'function'
    ) {
      throw RhinoException.forbidden(`Scope '${name}' is not allowed`);
    }
  }

  /**
   * Bind the raw value sent for one scope to the parameters its class declares.
   * Every argument is named: a positional list is not accepted.
   */
  private bindScopeArguments(
    name: string,
    reg: ModelRegistration,
    raw: any,
  ): Record<string, any> {
    const ScopeClass = reg.namedScopes![name] as any;
    const params: string[] = Array.isArray(ScopeClass.params) ? ScopeClass.params : [];
    const optional: string[] = Array.isArray(ScopeClass.optionalParams)
      ? ScopeClass.optionalParams
      : [];

    let given: Record<string, any>;
    if (raw == null || raw === '') {
      // ?scope[archived]= — no arguments. A scope with required parameters
      // still fails below, naming them.
      given = {};
    } else if (Array.isArray(raw)) {
      throw RhinoException.forbidden(`Scope '${name}' requires named parameters`);
    } else if (typeof raw !== 'object') {
      if (params.length === 0) {
        throw RhinoException.forbidden(`Scope '${name}' does not accept arguments`);
      }
      // A bare value binds to the single declared parameter. Two parameters can
      // never be guessed at from one value.
      if (params.length > 1) {
        throw RhinoException.forbidden(`Scope '${name}' requires named parameters`);
      }
      given = { [params[0]]: raw };
    } else {
      if (params.length === 0) {
        throw RhinoException.forbidden(`Scope '${name}' does not accept arguments`);
      }
      given = { ...(raw as Record<string, any>) };
    }

    for (const key of Object.keys(given)) {
      if (!params.includes(key)) {
        throw RhinoException.forbidden(`Scope '${name}' does not accept parameter '${key}'`);
      }
      if (given[key] !== null && typeof given[key] === 'object') {
        throw RhinoException.forbidden(`Scope '${name}' requires named parameters`);
      }
    }

    const args: Record<string, any> = {};
    for (const param of params) {
      if (Object.prototype.hasOwnProperty.call(given, param)) {
        args[param] = this.coerceScopeArgument(given[param]);
        continue;
      }
      if (!optional.includes(param)) {
        throw RhinoException.forbidden(`Scope '${name}' requires parameter '${param}'`);
      }
    }
    return args;
  }

  /**
   * Query-string values always arrive as strings; hand scope bodies real
   * booleans so a check cannot be fooled by the string "false".
   */
  private coerceScopeArgument(value: any): any {
    if (typeof value !== 'string') return value;
    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    return value;
  }

  /**
   * Scope names this user may select, or `['*']` when the policy does not
   * restrict them (the default, and the behavior of every policy written before
   * `permittedScopes()` existed).
   */
  private permittedScopeNames(reg: ModelRegistration, ctx: QueryContext): string[] {
    if (!reg.policy) return ['*'];
    const policy: any = new (reg.policy as any)();
    if (typeof policy.permittedScopes !== 'function') return ['*'];
    const permitted = policy.permittedScopes(ctx.user, ctx.organization);
    return Array.isArray(permitted) ? permitted.map((name: any) => String(name)) : ['*'];
  }

  /**
   * Whether this user may use an attribute as a query predicate: the same gate
   * the serializer applies to the response body. A dotted relation field is
   * left alone — the related model's own policy is not reachable from here.
   */
  private attributeQueryable(name: string, reg: ModelRegistration, ctx: QueryContext): boolean {
    if (!reg.policy || name.includes('.')) return true;
    const policy: any = new (reg.policy as any)();
    const hidden: string[] = policy.hiddenAttributesForShow?.(ctx.user, ctx.organization) ?? [];
    if (hidden.includes(name)) return false;
    const permitted: string[] = policy.permittedAttributesForShow?.(ctx.user, ctx.organization) ?? [
      '*',
    ];
    if (permitted.length === 1 && permitted[0] === '*') return true;
    return permitted.includes(name);
  }

  buildWhere(
    query: Record<string, any>,
    reg: ModelRegistration,
    ctx: QueryContext = {},
  ): Record<string, any> {
    const where: Record<string, any> = {};
    const filter = query.filter ?? {};
    const allowed = new Set(reg.allowedFilters ?? []);
    if (filter && typeof filter === 'object') {
      for (const [key, rawVal] of Object.entries(filter)) {
        if (!allowed.has(key)) continue;
        // Attribute permissions used to apply only when serializing, so a
        // hidden column stayed usable as a predicate: ?filter[salary]=300000
        // never printed a salary but told the caller whose salary it was.
        if (!this.attributeQueryable(key, reg, ctx)) {
          throw RhinoException.forbidden(`Filter '${key}' is not allowed`);
        }
        where[key] = this.parseFilterValue(rawVal);
      }
    }
    const search = query.search;
    if (search && reg.allowedSearch && reg.allowedSearch.length > 0) {
      const searchable = reg.allowedSearch.filter((field) =>
        this.attributeQueryable(field, reg, ctx),
      );
      if (searchable.length === 0) {
        // Every searchable column is hidden from this user. Searching a hidden
        // column tells the caller what is in it, so match nothing rather than
        // silently returning the whole list the client asked to narrow.
        where.OR = [];
        return where;
      }
      const fragments = searchable.map((field) => {
        if (field.includes('.')) {
          return this.buildRelationContains(field, String(search));
        }
        return { [field]: { contains: String(search), mode: 'insensitive' } };
      });
      where.OR = fragments;
    }
    return where;
  }

  private parseFilterValue(v: any): any {
    if (Array.isArray(v)) return { in: v };
    if (typeof v === 'string' && v.includes(',')) {
      return { in: v.split(',').filter(Boolean) };
    }
    return v;
  }

  private buildRelationContains(path: string, value: string): any {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    let inner: any = { [leaf]: { contains: value, mode: 'insensitive' } };
    while (parts.length) {
      const seg = parts.pop()!;
      inner = { [seg]: { is: inner } };
    }
    return inner;
  }

  buildOrderBy(query: Record<string, any>, reg: ModelRegistration, ctx: QueryContext = {}): any {
    const clientSupplied = query.sort != null && query.sort !== '';
    const raw = query.sort ?? reg.defaultSort;
    if (!raw) return undefined;
    const allowed = new Set(reg.allowedSorts ?? []);
    const tokens = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const orderings: any[] = [];
    for (const tok of tokens) {
      const desc = tok.startsWith('-');
      const field = desc ? tok.slice(1) : tok;
      if (allowed.size > 0 && !allowed.has(field)) {
        throw new BadRequestException(`Sort not allowed: ${field}`);
      }
      // The model's own defaultSort is the server's choice, not the client's.
      if (clientSupplied && !this.attributeQueryable(field, reg, ctx)) {
        throw RhinoException.forbidden(`Sort '${field}' is not allowed`);
      }
      orderings.push({ [field]: desc ? 'desc' : 'asc' });
    }
    return orderings;
  }

  buildInclude(query: Record<string, any>, reg: ModelRegistration): Record<string, any> | undefined {
    const raw = query.include;
    if (!raw) return undefined;
    const allowed = new Set(reg.allowedIncludes ?? []);
    const paths = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const include: Record<string, any> = {};
    for (const path of paths) {
      if (allowed.size > 0 && !allowed.has(path) && !allowed.has(path.split('.')[0])) {
        throw new BadRequestException(`Include not allowed: ${path}`);
      }
      this.assignInclude(include, path.split('.'));
    }
    return include;
  }

  private assignInclude(target: Record<string, any>, parts: string[]): void {
    const [head, ...rest] = parts;
    if (!head) return;
    if (rest.length === 0) {
      if (!target[head]) target[head] = true;
      return;
    }
    if (target[head] === true || !target[head]) target[head] = { include: {} };
    if (!target[head].include) target[head].include = {};
    this.assignInclude(target[head].include, rest);
  }

  buildSelect(query: Record<string, any>, reg: ModelRegistration): Record<string, any> | undefined {
    const fields = query.fields;
    if (!fields || typeof fields !== 'object') return undefined;
    // Support either ?fields[slug]=... or ?fields[_]=...; pick first non-empty
    const raw = Object.values(fields)[0];
    if (!raw) return undefined;
    const allowed = new Set(reg.allowedFields ?? []);
    const names = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const select: Record<string, any> = { id: true };
    // Seed the resolved route-key column too, so ?fields[] responses always
    // include the value clients need to address the record.
    const routeKey = reg.routeKey ?? this.config?.globalRouteKey() ?? 'id';
    if (routeKey !== 'id') select[routeKey] = true;
    for (const name of names) {
      if (allowed.size > 0 && !allowed.has(name)) {
        throw new BadRequestException(`Field not allowed: ${name}`);
      }
      select[name] = true;
    }
    return select;
  }

  private parseInt(v: any): number | undefined {
    if (v == null) return undefined;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}
