import * as fs from 'fs';
import * as path from 'path';
import type { RhinoConfig, ModelRegistration } from '../interfaces/rhino-config.interface';

export interface ScopeDiscoveryOptions {
  /**
   * Absolute or cwd-relative directory to scan. Defaults to `./src/scopes`.
   */
  scopesDir?: string;
  /**
   * File extensions to probe, in order. Defaults to `['.ts', '.js']`.
   */
  extensions?: string[];
  /**
   * When true, silently skip models whose scope file cannot be loaded.
   * When false, throw the underlying require error. Default: true.
   */
  silent?: boolean;
}

/**
 * Filesystem-based scope auto-discovery, mirroring Laravel's naming-convention
 * discovery (`App\Models\Scopes\{Model}Scope`).
 *
 * For each model registered in `config.models`, the helper looks for a file
 * named `{ModelName}Scope.{ts,js}` in `scopesDir`. If found and the file
 * default-exports a class (or exports a class under `{ModelName}Scope`), that
 * class is appended to the model's `scopes` array (deduped).
 *
 * Usage:
 *
 *   const config = autoDiscoverScopes({ models: {...} }, { scopesDir: 'src/scopes' });
 *   RhinoModule.forRoot(config);
 *
 * The function is synchronous and returns a new config object — it does not
 * mutate the input.
 */
export function autoDiscoverScopes(
  config: RhinoConfig,
  options: ScopeDiscoveryOptions = {},
): RhinoConfig {
  const scopesDir = path.resolve(options.scopesDir ?? path.join(process.cwd(), 'src', 'scopes'));
  const extensions = options.extensions ?? ['.ts', '.js'];
  const silent = options.silent ?? true;

  if (!fs.existsSync(scopesDir)) return config;

  const newModels: Record<string, ModelRegistration> = {};
  for (const [slug, reg] of Object.entries(config.models ?? {})) {
    const modelClassName = pascal(reg.model);
    const scopeClass = loadScopeFile(scopesDir, modelClassName, extensions, silent);
    if (scopeClass) {
      const existing = reg.scopes ?? [];
      const deduped = existing.includes(scopeClass) ? existing : [...existing, scopeClass];
      newModels[slug] = { ...reg, scopes: deduped };
    } else {
      newModels[slug] = reg;
    }
  }

  return { ...config, models: newModels };
}

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function loadScopeFile(
  dir: string,
  modelName: string,
  extensions: string[],
  silent: boolean,
): any | null {
  const basename = `${modelName}Scope`;
  for (const ext of extensions) {
    const candidate = path.join(dir, `${basename}${ext}`);
    if (!fs.existsSync(candidate)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(candidate);
      // Support: `module.exports = Class`, `export default Class`, `export class XScope`
      if (mod && typeof mod === 'function') return mod;
      return mod?.default ?? mod?.[basename] ?? null;
    } catch (err) {
      if (!silent) throw err;
      return null;
    }
  }
  return null;
}
