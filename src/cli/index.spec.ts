import { parseFlags, extractCommand, printHelp, main } from './index';

// -----------------------------------------------------------------------
// parseFlags
// -----------------------------------------------------------------------
describe('parseFlags', () => {
  it('parses --flag as boolean true', () => {
    expect(parseFlags(['--force'])).toEqual({ force: true });
  });

  it('parses --key=value', () => {
    expect(parseFlags(['--output=file.json'])).toEqual({ output: 'file.json' });
  });

  it('parses --base-url=http://localhost:3000', () => {
    expect(parseFlags(['--base-url=http://localhost:3000'])).toEqual({
      'base-url': 'http://localhost:3000',
    });
  });

  it('ignores non-flag positional args', () => {
    expect(parseFlags(['blueprint', '--force', '--model=post'])).toEqual({
      force: true,
      model: 'post',
    });
  });

  it('returns empty object for no flags', () => {
    expect(parseFlags(['blueprint'])).toEqual({});
  });

  it('parses --dry-run flag', () => {
    expect(parseFlags(['--dry-run'])).toEqual({ 'dry-run': true });
  });
});

// -----------------------------------------------------------------------
// extractCommand
// -----------------------------------------------------------------------
describe('extractCommand', () => {
  it('returns first non-flag argument', () => {
    expect(extractCommand(['install'])).toBe('install');
    expect(extractCommand(['--force', 'blueprint'])).toBe('blueprint');
    expect(extractCommand(['export-postman', '--output=out.json'])).toBe(
      'export-postman',
    );
  });

  it('returns undefined when no positional args', () => {
    expect(extractCommand(['--force'])).toBeUndefined();
    expect(extractCommand([])).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// printHelp — smoke test (should not throw)
// -----------------------------------------------------------------------
describe('printHelp', () => {
  it('prints without throwing', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printHelp()).not.toThrow();
    spy.mockRestore();
  });
});

// -----------------------------------------------------------------------
// main dispatcher
// -----------------------------------------------------------------------

// Mock the command handlers to avoid side effects
jest.mock('./commands/install.command', () => ({
  runInstall: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./commands/generate.command', () => ({
  runGenerate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./commands/blueprint.command', () => ({
  runBlueprint: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./commands/export-postman.command', () => ({
  runExportPostman: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./commands/export-types.command', () => ({
  runExportTypes: jest.fn().mockResolvedValue(undefined),
}));

import { runInstall } from './commands/install.command';
import { runGenerate } from './commands/generate.command';
import { runBlueprint } from './commands/blueprint.command';
import { runExportPostman } from './commands/export-postman.command';
import { runExportTypes } from './commands/export-types.command';

describe('main dispatcher', () => {
  let exitSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('dispatches "install" to runInstall', async () => {
    await main(['install']);
    expect(runInstall).toHaveBeenCalledTimes(1);
  });

  it('dispatches "generate" to runGenerate', async () => {
    await main(['generate']);
    expect(runGenerate).toHaveBeenCalledTimes(1);
  });

  it('dispatches "blueprint" with no flags', async () => {
    await main(['blueprint']);
    expect(runBlueprint).toHaveBeenCalledWith({
      force: false,
      dryRun: false,
      model: undefined,
    });
  });

  it('dispatches "blueprint" with --force --dry-run --model=post', async () => {
    await main(['blueprint', '--force', '--dry-run', '--model=post']);
    expect(runBlueprint).toHaveBeenCalledWith({
      force: true,
      dryRun: true,
      model: 'post',
    });
  });

  it('dispatches "export-postman" with --output and --base-url', async () => {
    await main([
      'export-postman',
      '--output=out.json',
      '--base-url=http://localhost:4000/api',
    ]);
    expect(runExportPostman).toHaveBeenCalledWith({
      output: 'out.json',
      baseUrl: 'http://localhost:4000/api',
    });
  });

  it('dispatches "export-types" with --output', async () => {
    await main(['export-types', '--output=src/types/api.d.ts']);
    expect(runExportTypes).toHaveBeenCalledWith({
      output: 'src/types/api.d.ts',
    });
  });

  it('prints help and exits 1 on unknown command', async () => {
    await main(['unknown-command']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints help (no exit) when no command is given', async () => {
    await main([]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
