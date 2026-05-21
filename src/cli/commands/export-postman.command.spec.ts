/**
 * export-postman command tests.
 *
 * PostmanExporter is mocked — it may not exist yet.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../exporters/postman-exporter', () => ({
  generate: jest.fn((_config: unknown, _opts: unknown) =>
    JSON.stringify({ info: { name: 'Test Collection' } }, null, 2),
  ),
}));

import { runExportPostman } from './export-postman.command';
import { generate as mockGenerate } from '../../exporters/postman-exporter';

describe('runExportPostman', () => {
  let tmpDir: string;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-postman-'));
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('writes JSON file to default output path', async () => {
    const outputPath = path.join(tmpDir, 'postman_collection.json');
    await runExportPostman({ output: outputPath });

    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(JSON.parse(content)).toHaveProperty('info.name', 'Test Collection');
  });

  it('passes baseUrl to the generator', async () => {
    const outputPath = path.join(tmpDir, 'out.json');
    await runExportPostman({
      output: outputPath,
      baseUrl: 'http://localhost:4000/api',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ baseUrl: 'http://localhost:4000/api' }),
    );
  });

  it('creates parent directories as needed', async () => {
    const outputPath = path.join(tmpDir, 'nested', 'dir', 'out.json');
    await runExportPostman({ output: outputPath });
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('exits with code 1 when exporter module is absent', async () => {
    jest.resetModules();
    jest.doMock('../../exporters/postman-exporter', () => {
      throw new Error('Module not found');
    });

    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { runExportPostman: freshRun } = await import(
      './export-postman.command'
    );
    await freshRun({});

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errSpy.mockRestore();
    jest.resetModules();
  });
});
