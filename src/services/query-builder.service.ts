import { BadRequestException, Injectable } from '@nestjs/common';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';
import { RhinoException } from '../errors/rhino-exception';

export interface ParsedQuery {
  where: Record<string, any>;
  orderBy: any;
  include?: Record<string, any>;
  select?: Record<string, any>;
  page?: number;
  perPage?: number;
  /** Validated named-scope key to apply (index/trashed only). */
  scopeName?: string;
}

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
  build(
    query: Record<string, any>,
    reg: ModelRegistration,
    opts: { namedScopes?: boolean } = {},
  ): ParsedQuery {
    const parsed: ParsedQuery = {
      where: this.buildWhere(query, reg),
      orderBy: this.buildOrderBy(query, reg),
      include: this.buildInclude(query, reg),
      select: this.buildSelect(query, reg),
      page: this.parseInt(query.page),
      perPage: this.parseInt(query.per_page ?? query.perPage),
    };

    if (opts.namedScopes) {
      // A non-string (e.g. repeated/array ?scope=a&scope=b) is never a valid
      // scope name — reject it before any prototype-key lookups.
      if (query.scope != null && typeof query.scope !== 'string') {
        throw RhinoException.forbidden(`Scope is not allowed`);
      }
      const requested =
        typeof query.scope === 'string' && query.scope !== '' ? query.scope : undefined;
      const scopeName = requested ?? reg.defaultScope;
      if (scopeName !== undefined) {
        if (
          !reg.namedScopes ||
          !Object.prototype.hasOwnProperty.call(reg.namedScopes, scopeName) ||
          typeof reg.namedScopes[scopeName] !== 'function'
        ) {
          throw RhinoException.forbidden(`Scope '${scopeName}' is not allowed`);
        }
        parsed.scopeName = scopeName;
      }
    }

    return parsed;
  }

  buildWhere(query: Record<string, any>, reg: ModelRegistration): Record<string, any> {
    const where: Record<string, any> = {};
    const filter = query.filter ?? {};
    const allowed = new Set(reg.allowedFilters ?? []);
    if (filter && typeof filter === 'object') {
      for (const [key, rawVal] of Object.entries(filter)) {
        if (!allowed.has(key)) continue;
        where[key] = this.parseFilterValue(rawVal);
      }
    }
    const search = query.search;
    if (search && reg.allowedSearch && reg.allowedSearch.length > 0) {
      const fragments = reg.allowedSearch.map((field) => {
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

  buildOrderBy(query: Record<string, any>, reg: ModelRegistration): any {
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
