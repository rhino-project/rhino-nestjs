import { ask, confirm, selectFromList, type ReadlineInterface } from './prompt';

// -----------------------------------------------------------------------
// Minimal fake ReadlineInterface
// -----------------------------------------------------------------------

/** Create a mock rl that answers questions in order from the `answers` queue. */
function mockRl(answers: string[]): ReadlineInterface {
  const queue = [...answers];
  return {
    question(_query: string, cb: (a: string) => void) {
      const answer = queue.shift() ?? '';
      // Use setImmediate to simulate async behaviour without real I/O
      setImmediate(() => cb(answer));
    },
    close: jest.fn(),
  };
}

// -----------------------------------------------------------------------
// ask
// -----------------------------------------------------------------------
describe('ask', () => {
  it('returns the trimmed answer', async () => {
    const rl = mockRl(['  hello  ']);
    await expect(ask(rl, 'Say hi: ')).resolves.toBe('hello');
  });

  it('returns empty string when answer is empty', async () => {
    const rl = mockRl(['']);
    await expect(ask(rl, 'Empty: ')).resolves.toBe('');
  });
});

// -----------------------------------------------------------------------
// confirm
// -----------------------------------------------------------------------
describe('confirm', () => {
  it('returns true for "y" answer', async () => {
    const rl = mockRl(['y']);
    await expect(confirm(rl, 'Proceed?')).resolves.toBe(true);
  });

  it('returns true for "Y" answer', async () => {
    const rl = mockRl(['Y']);
    await expect(confirm(rl, 'Proceed?')).resolves.toBe(true);
  });

  it('returns false for "n" answer', async () => {
    const rl = mockRl(['n']);
    await expect(confirm(rl, 'Proceed?', true)).resolves.toBe(false);
  });

  it('uses defaultValue=true when answer is empty', async () => {
    const rl = mockRl(['']);
    await expect(confirm(rl, 'Proceed?', true)).resolves.toBe(true);
  });

  it('uses defaultValue=false when answer is empty', async () => {
    const rl = mockRl(['']);
    await expect(confirm(rl, 'Proceed?', false)).resolves.toBe(false);
  });

  it('returns false for "no" answer', async () => {
    const rl = mockRl(['no']);
    await expect(confirm(rl, 'Delete?', true)).resolves.toBe(false);
  });
});

// -----------------------------------------------------------------------
// selectFromList
// -----------------------------------------------------------------------
describe('selectFromList', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('returns option at chosen index', async () => {
    const rl = mockRl(['2']);
    const result = await selectFromList(rl, 'Pick:', ['model', 'policy', 'scope']);
    expect(result).toBe('policy');
  });

  it('returns default option when answer is empty', async () => {
    const rl = mockRl(['']);
    const result = await selectFromList(rl, 'Pick:', ['model', 'policy', 'scope'], 0);
    expect(result).toBe('model');
  });

  it('returns default when answer is out of range', async () => {
    const rl = mockRl(['99']);
    const result = await selectFromList(rl, 'Pick:', ['a', 'b', 'c'], 1);
    expect(result).toBe('b');
  });

  it('returns default when answer is not a number', async () => {
    const rl = mockRl(['banana']);
    const result = await selectFromList(rl, 'Pick:', ['x', 'y'], 0);
    expect(result).toBe('x');
  });
});
