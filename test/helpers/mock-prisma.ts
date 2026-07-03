/**
 * A minimal in-memory Prisma stand-in. Implements the subset of model delegate
 * methods the Rhino framework actually calls: findMany, findFirst,
 * findUnique, create, update, updateMany, delete, deleteMany, count, $transaction.
 */
export function createMockPrisma(initialData: Record<string, any[]> = {}) {
  const data: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(initialData)) data[k] = [...v];

  function matchesWhere(record: any, where: any): boolean {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      // Boolean combinators are handled by the OR/AND-aware `matches` wrapper;
      // recurse through it so nested AND/OR compose correctly.
      if (k === 'AND' || k === 'OR') {
        if (!matches(record, { [k]: v })) return false;
        continue;
      }
      if (v == null && record[k] == null) continue;
      if (v != null && typeof v === 'object' && 'in' in (v as any)) {
        if (!(v as any).in.includes(record[k])) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && 'contains' in (v as any)) {
        if (
          !String(record[k] ?? '')
            .toLowerCase()
            .includes(String((v as any).contains).toLowerCase())
        ) {
          return false;
        }
        continue;
      }
      if (v != null && typeof v === 'object' && 'not' in (v as any)) {
        if (record[k] === (v as any).not) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && 'is' in (v as any)) {
        if (!matches(record[k] ?? {}, (v as any).is)) return false;
        continue;
      }
      // Relation quantifiers over an array-valued record field.
      if (v != null && typeof v === 'object' && 'some' in (v as any)) {
        const arr = Array.isArray(record[k]) ? record[k] : [];
        if (!arr.some((el: any) => matches(el, (v as any).some))) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && 'none' in (v as any)) {
        const arr = Array.isArray(record[k]) ? record[k] : [];
        if (arr.some((el: any) => matches(el, (v as any).none))) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && 'every' in (v as any)) {
        const arr = Array.isArray(record[k]) ? record[k] : [];
        if (!arr.every((el: any) => matches(el, (v as any).every))) return false;
        continue;
      }
      if (record[k] !== v) return false;
    }
    return true;
  }

  /**
   * OR/AND-aware where evaluator. Every findMany/findFirst/count filter routes
   * through this so top-level `AND` (produced by named scopes) and `OR`
   * (produced by search) compose with the plain field matcher.
   */
  function matches(record: any, where: any): boolean {
    if (!where) return true;
    const rest = { ...where };
    let ok = true;
    if (Array.isArray(where.AND)) {
      ok = ok && where.AND.every((frag: any) => matches(record, frag));
      delete rest.AND;
    }
    if (Array.isArray(where.OR)) {
      ok = ok && where.OR.some((frag: any) => matches(record, frag));
      delete rest.OR;
    }
    return ok && matchesWhere(record, rest);
  }

  // Backwards-compatible alias for the delegate call sites below.
  const applyOrWhere = matches;

  function makeDelegate(modelName: string) {
    if (!data[modelName]) data[modelName] = [];
    const coll = () => data[modelName];
    let autoId = 1;

    return {
      findMany: async (args: any = {}) => {
        let rows = coll().filter((r) => applyOrWhere(r, args.where));
        if (args.orderBy) {
          const orderings = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          rows = [...rows].sort((a, b) => {
            for (const o of orderings) {
              const [k, dir] = Object.entries(o)[0] as [string, string];
              const av = a[k];
              const bv = b[k];
              if (av === bv) continue;
              return (av > bv ? 1 : -1) * (dir === 'desc' ? -1 : 1);
            }
            return 0;
          });
        }
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      },
      findFirst: async (args: any = {}) => {
        return coll().find((r) => applyOrWhere(r, args.where)) ?? null;
      },
      findUnique: async (args: any = {}) => {
        return coll().find((r) => matchesWhere(r, args.where)) ?? null;
      },
      count: async (args: any = {}) => {
        return coll().filter((r) => applyOrWhere(r, args.where)).length;
      },
      create: async (args: any) => {
        const row = { id: autoId++, ...args.data };
        coll().push(row);
        return row;
      },
      update: async (args: any) => {
        const row = coll().find((r) => matchesWhere(r, args.where));
        if (!row) throw new Error(`No record to update in ${modelName}`);
        Object.assign(row, args.data);
        return row;
      },
      updateMany: async (args: any) => {
        let count = 0;
        for (const r of coll()) {
          if (matchesWhere(r, args.where)) {
            Object.assign(r, args.data);
            count++;
          }
        }
        return { count };
      },
      delete: async (args: any) => {
        const idx = coll().findIndex((r) => matchesWhere(r, args.where));
        if (idx < 0) throw new Error(`No record to delete in ${modelName}`);
        const [removed] = coll().splice(idx, 1);
        return removed;
      },
      deleteMany: async (args: any) => {
        let count = 0;
        for (let i = coll().length - 1; i >= 0; i--) {
          if (matchesWhere(coll()[i], args.where)) {
            coll().splice(i, 1);
            count++;
          }
        }
        return { count };
      },
      upsert: async (args: any) => {
        const existing = coll().find((r) => matchesWhere(r, args.where));
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = { id: autoId++, ...args.create };
        coll().push(row);
        return row;
      },
    };
  }

  const client: any = new Proxy(
    {
      $transaction: async (fn: any) => fn(client),
      $connect: async () => {},
      $disconnect: async () => {},
      _data: data,
      _reset: (fresh: Record<string, any[]>) => {
        for (const k of Object.keys(data)) delete data[k];
        for (const [k, v] of Object.entries(fresh)) data[k] = [...v];
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string') {
          if (!target[prop]) target[prop] = makeDelegate(prop);
          return target[prop];
        }
        return undefined;
      },
    },
  );
  return client;
}
