/**
 * rhino blueprint [--force] [--dry-run] [--model=slug]
 *
 * Delegates to BlueprintRunner (src/blueprint/blueprint-runner.ts).
 *
 * NOTE: BlueprintRunner is loaded via a dynamic require() so that this CLI
 * file compiles and runs even when blueprint-runner.ts has not yet been built.
 * When the runner is absent, the command exits with code 1 and prints a
 * helpful message.
 */

export interface BlueprintOptions {
  force?: boolean;
  dryRun?: boolean;
  model?: string;
}

export async function runBlueprint(opts: BlueprintOptions): Promise<void> {
  // Lazy-load the runner so the CLI still compiles without the dependency.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let runner: { run: (opts: BlueprintOptions) => Promise<void> };

  try {
    // Try compiled dist first, then fall back to ts source path.
    // The runner module must export a default object or a named `BlueprintRunner`
    // with a `run(opts)` method — or itself be the function.
    const mod = require('../../blueprint/blueprint-runner');
    const RunnerClass = mod.BlueprintRunner ?? mod.default;
    runner = typeof RunnerClass === 'function' ? new RunnerClass() : RunnerClass;
  } catch {
    console.error(
      '  Error: BlueprintRunner not found.\n' +
        '  Make sure src/blueprint/blueprint-runner.ts exists and the project is built.\n' +
        '  Expected export: class BlueprintRunner { async run(opts) { ... } }',
    );
    process.exit(1);
    return;
  }

  await runner.run(opts);
}
