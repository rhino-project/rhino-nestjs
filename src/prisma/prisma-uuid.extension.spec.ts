import { withUuid } from './prisma-uuid.extension';

function makeFakePrisma() {
  let registered: any = null;
  const client: any = {
    _hooks: () => registered?.query?.$allModels ?? {},
    $extends: (ext: any) => {
      registered = ext;
      return client;
    },
  };
  return client;
}

async function runHook(hook: any, args: any, queryFn: any) {
  return hook.call(null, { model: args.model, args: args.args, query: queryFn });
}

describe('withUuid extension', () => {
  it('generates a UUID when creating a soft-listed model without an id', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['comment']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockImplementation((args: any) => Promise.resolve(args.data));
    const result: any = await runHook(
      hooks.create,
      { model: 'comment', args: { data: { body: 'hi' } } },
      query,
    );
    expect(typeof result.id).toBe('string');
    // UUID format check
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('does not overwrite a user-provided id', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['comment']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockImplementation((args: any) => Promise.resolve(args.data));
    const result: any = await runHook(
      hooks.create,
      { model: 'comment', args: { data: { id: 'user-supplied', body: 'hi' } } },
      query,
    );
    expect(result.id).toBe('user-supplied');
  });

  it('leaves non-UUID models untouched', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['comment']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockImplementation((args: any) => Promise.resolve(args.data));
    const result: any = await runHook(
      hooks.create,
      { model: 'post', args: { data: { title: 'hi' } } },
      query,
    );
    expect(result.id).toBeUndefined();
  });

  it('is case-insensitive when matching model names', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['Comment']); // PascalCase declaration
    const hooks = prisma._hooks();
    const query = jest.fn().mockImplementation((args: any) => Promise.resolve(args.data));
    const result: any = await runHook(
      hooks.create,
      { model: 'comment', args: { data: {} } },
      query,
    );
    expect(typeof result.id).toBe('string');
  });

  it('passes through when args.data is missing', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['comment']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockResolvedValue({});
    await runHook(hooks.create, { model: 'comment', args: {} }, query);
    expect(query).toHaveBeenCalled();
  });

  it('generates unique UUIDs across calls', async () => {
    const prisma = makeFakePrisma();
    withUuid(prisma, ['comment']);
    const hooks = prisma._hooks();
    const query = jest.fn().mockImplementation((args: any) => Promise.resolve(args.data));
    const r1: any = await runHook(hooks.create, { model: 'comment', args: { data: {} } }, query);
    const r2: any = await runHook(hooks.create, { model: 'comment', args: { data: {} } }, query);
    expect(r1.id).not.toBe(r2.id);
  });
});
