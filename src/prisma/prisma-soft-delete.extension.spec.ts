import { withSoftDelete } from './prisma-soft-delete.extension';

/**
 * Simulate a Prisma client with `$extends` that wires query-middleware hooks.
 * The mock stores the registered handlers and exposes them for inspection.
 */
function makeFakePrisma() {
  let registered: any = null;
  const client: any = {
    _hooks: () => registered?.query?.$allModels ?? {},
    $extends: (ext: any) => {
      registered = ext;
      return client; // return same object for chainability (like real Prisma)
    },
    // model delegates that the extension's delete handler re-invokes
    post: {
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
    },
    comment: {
      update: jest.fn(),
    },
  };
  return client;
}

async function runHook<T>(hook: any, args: any, queryFn: any): Promise<T> {
  return hook.call(null, { model: args.model, args: args.args, query: queryFn });
}

describe('withSoftDelete extension', () => {
  it('findMany appends deletedAt:null for soft-delete models', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue([]);
    await runHook(hooks.findMany, { model: 'post', args: { where: { status: 'draft' } } }, query);
    expect(query).toHaveBeenCalledWith({ where: { status: 'draft', deletedAt: null } });
  });

  it('findMany leaves non-soft-delete models alone', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue([]);
    await runHook(hooks.findMany, { model: 'tag', args: { where: {} } }, query);
    expect(query).toHaveBeenCalledWith({ where: {} });
  });

  it('does not overwrite explicit deletedAt in args', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue([]);
    // user explicitly wants only soft-deleted records
    await runHook(
      hooks.findMany,
      { model: 'post', args: { where: { deletedAt: { not: null } } } },
      query,
    );
    expect(query).toHaveBeenCalledWith({ where: { deletedAt: { not: null } } });
  });

  it('findFirst also gets the soft-delete filter', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue(null);
    await runHook(hooks.findFirst, { model: 'post', args: {} }, query);
    expect(query).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('count respects soft-delete filtering', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue(0);
    await runHook(hooks.count, { model: 'post', args: {} }, query);
    expect(query).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('count works when args is undefined', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue(0);
    await runHook(hooks.count, { model: 'post', args: undefined }, query);
    expect(query).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('delete rewrites to update {deletedAt: new Date()} for soft-delete models', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn(); // should not be called — the hook bypasses it
    await runHook(hooks.delete, { model: 'post', args: { where: { id: 1 } } }, query);
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('delete passes through for non-soft-delete models', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['post']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue({ id: 1 });
    await runHook(hooks.delete, { model: 'tag', args: { where: { id: 1 } } }, query);
    expect(query).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('case-insensitive model matching', async () => {
    const prisma = makeFakePrisma();
    withSoftDelete(prisma, ['POST']); // uppercase declaration
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue([]);
    await runHook(hooks.findMany, { model: 'post', args: {} }, query);
    expect(query).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });
});
