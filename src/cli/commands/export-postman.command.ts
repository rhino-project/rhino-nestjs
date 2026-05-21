/**
 * rhino export-postman [--output=file.json] [--base-url=http://localhost:3000/api]
 *
 * Delegates to PostmanExporter (src/exporters/postman-exporter.ts).
 *
 * NOTE: PostmanExporter is loaded via a dynamic require() so that this CLI
 * file compiles and runs even when the exporter has not yet been built.
 */
import { writeFileSafely } from '../utils/io';

export interface ExportPostmanOptions {
  output?: string;
  baseUrl?: string;
}

export async function runExportPostman(
  opts: ExportPostmanOptions,
): Promise<void> {
  const outputPath = opts.output ?? 'postman_collection.json';
  const baseUrl = opts.baseUrl ?? 'http://localhost:3000/api';

  // Lazy-load the exporter.
  // Expected export: function generate(config, opts): string
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let generate: (config: Record<string, unknown>, opts: ExportPostmanOptions) => string;

  try {
    const mod = require('../../exporters/postman-exporter');
    generate = mod.generate ?? mod.default?.generate;
    if (typeof generate !== 'function') throw new Error('generate not a function');
  } catch {
    console.error(
      '  Error: PostmanExporter not found.\n' +
        '  Make sure src/exporters/postman-exporter.ts exists and the project is built.\n' +
        '  Expected export: function generate(config, opts): string',
    );
    process.exit(1);
    return;
  }

  // PostmanExporter reads the live config — pass empty config here;
  // the exporter itself will load rhino.config or equivalent.
  const json = generate({}, { output: outputPath, baseUrl });

  writeFileSafely(outputPath, json);
  console.log(`  Postman collection written to: ${outputPath}`);
}
