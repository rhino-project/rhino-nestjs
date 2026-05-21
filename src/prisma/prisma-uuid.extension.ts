import { randomUUID } from 'crypto';

/**
 * Prisma client extension that auto-generates UUIDs for models listed in `uuidModels`.
 * This is a convenience wrapper — Prisma's `@default(uuid())` on the schema is
 * the preferred approach, but this helper covers cases where the schema is not
 * owned by the library or migration-controlled.
 */
export function withUuid<T extends { $extends: Function }>(prisma: T, uuidModels: string[]): T {
  const uuidSet = new Set(uuidModels.map((m) => m.toLowerCase()));
  const needsUuid = (model?: string) => !!model && uuidSet.has(model.toLowerCase());

  return (prisma as any).$extends({
    name: 'rhino-uuid',
    query: {
      $allModels: {
        async create({ model, args, query }: any) {
          if (needsUuid(model) && args?.data && args.data.id == null) {
            args = { ...args, data: { ...args.data, id: randomUUID() } };
          }
          return query(args);
        },
      },
    },
  }) as T;
}
