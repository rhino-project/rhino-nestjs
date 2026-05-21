/**
 * export-types command tests.
 *
 * TypeScriptExporter is mocked — it may not exist yet.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../exporters/typescript-exporter', () => ({
  generate: jest.fn((_config: unknown, _opts: unknown) =>
    `// auto-generated\nexport interface User { id: number; }\n`,
  ),
}));

import { runExportTypes } from './export-types.command';
import { generate as mockGenerate } from '../../exporters/typescript-exporter';

describe('runExportTypes', () => {
  let tmpDir: string;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-types-'));
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('writes .d.ts file to default output path', async () => {
    const outputPath = path.join(tmpDir, 'src', 'types', 'rhino.d.ts');
    await runExportTypes({ output: outputPath });

    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('export interface User');
  });

  it('passes output option to the generator', async () => {
    const outputPath = path.join(tmpDir, 'types.d.ts');
    await runExportTypes({ output: outputPath });

    expect(mockGenerate).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ output: outputPath }),
    );
  });

  it('creates parent directories as needed', async () => {
    const outputPath = path.join(tmpDir, 'deep', 'nested', 'types.d.ts');
    await runExportTypes({ output: outputPath });
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('exits with code 1 when exporter module is absent', async () => {
    jest.resetModules();
    jest.doMock('../../exporters/typescript-exporter', () => {
      throw new Error('Module not found');
    });

    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { runExportTypes: freshRun } = await import('./export-types.command');
    await freshRun({});

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errSpy.mockRestore();
    jest.resetModules();
  });
});
