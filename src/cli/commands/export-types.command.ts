/**
 * rhino export-types [--output=path/to/types.d.ts]
 *
 * Delegates to TypeScriptExporter (src/exporters/typescript-exporter.ts).
 *
 * NOTE: TypeScriptExporter is loaded via a dynamic require() so that this CLI
 * file compiles and runs even when the exporter has not yet been built.
 */
import { writeFileSafely } from '../utils/io';

export interface ExportTypesOptions {
  output?: string;
}

export async function runExportTypes(
  opts: ExportTypesOptions,
): Promise<void> {
  const outputPath = opts.output ?? 'src/types/rhino.d.ts';

  // Lazy-load the exporter.
  // Expected export: function generate(config, opts): string
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let generate: (config: Record<string, unknown>, opts: ExportTypesOptions) => string;

  try {
    const mod = require('../../exporters/typescript-exporter');
    generate = mod.generate ?? mod.default?.generate;
    if (typeof generate !== 'function') throw new Error('generate not a function');
  } catch {
    console.error(
      '  Error: TypeScriptExporter not found.\n' +
        '  Make sure src/exporters/typescript-exporter.ts exists and the project is built.\n' +
        '  Expected export: function generate(config, opts): string',
    );
    process.exit(1);
    return;
  }

  const dts = generate({}, { output: outputPath });

  writeFileSafely(outputPath, dts);
  console.log(`  TypeScript types written to: ${outputPath}`);
}
