/**
 * Prisma client extension implementing Laravel-style soft deletes.
 *
 *   import { PrismaClient } from '@prisma/client';
 *   import { withSoftDelete } from '@rhino-project/rhino-nestjs';
 *
 *   const prisma = withSoftDelete(new PrismaClient(), ['post', 'comment']);
 *
 * When applied, the extension:
 *   - auto-appends `deletedAt: null` to `findMany`, `findFirst`, `findUnique`, `count`
 *   - rewrites `delete` to `update { deletedAt: new Date() }`
 *   - leaves `deleteMany` untouched (hard delete) so the framework can offer forceDelete
 */
export function withSoftDelete<T extends { $extends: Function }>(
  prisma: T,
  softDeleteModels: string[],
): T {
  const softSet = new Set(softDeleteModels.map((m) => m.toLowerCase()));

  const isSoft = (model?: string) => !!model && softSet.has(model.toLowerCase());

  const applyFilter = (args: any) => {
    const base = args.where ?? {};
    if (base.deletedAt !== undefined) return args;
    return { ...args, where: { ...base, deletedAt: null } };
  };

  return (prisma as any).$extends({
    name: 'rhino-soft-delete',
    query: {
      $allModels: {
        async findMany({ model, args, query }: any) {
          return isSoft(model) ? query(applyFilter(args)) : query(args);
        },
        async findFirst({ model, args, query }: any) {
          return isSoft(model) ? query(applyFilter(args)) : query(args);
        },
        async findFirstOrThrow({ model, args, query }: any) {
          return isSoft(model) ? query(applyFilter(args)) : query(args);
        },
        async count({ model, args, query }: any) {
          return isSoft(model) ? query(applyFilter(args ?? {})) : query(args);
        },
        async delete({ model, args, query }: any) {
          if (!isSoft(model)) return query(args);
          return (prisma as any)[camel(model)].update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        },
      },
    },
  }) as T;
}

function camel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
