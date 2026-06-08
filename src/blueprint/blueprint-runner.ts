import * as fs from 'fs';
import * as path from 'path';

import { BlueprintParser } from './blueprint-parser';
import { BlueprintValidator } from './blueprint-validator';
import { BlueprintSorter } from './blueprint-sorter';
import { ManifestManager } from './manifest-manager';
import { PrismaSchemaGenerator } from './generators/prisma-schema-generator';
import { ResourceDefinitionGenerator } from './generators/resource-definition-generator';
import { PolicyGenerator } from './generators/policy-generator';
import { TestGenerator } from './generators/test-generator';
import { SeederGenerator } from './generators/seeder-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  /** Root directory of the consuming project (defaults to cwd) */
  projectRoot?: string;
  /** Only process a blueprint whose model name matches (e.g. 'Post') */
  model?: string;
  /** Validate + report without writing any files */
  dryRun?: boolean;
  /** Ignore the manifest and re-generate all blueprints */
  force?: boolean;
  /** Silence progress output */
  silent?: boolean;
}

export interface RunnerResult {
  processed: string[];
  skipped: string[];
  errors: Array<{ file: string; error: string }>;
  generatedFiles: string[];
}

// ---------------------------------------------------------------------------
// BlueprintRunner
// ---------------------------------------------------------------------------

/**
 * Orchestrator: discovers `*.yaml` files in `.rhino/blueprints/`,
 * validates them, skips unchanged ones (via ManifestManager), and runs all
 * five generators per blueprint.
 *
 * Flags:
 *  --dry-run    → validate + plan without writing
 *  --force      → ignore manifest, re-generate everything
 *  --model=Foo  → only process the blueprint whose `model:` is 'Foo'
 */
export class BlueprintRunner {
  private readonly parser = new BlueprintParser();
  private readonly validator = new BlueprintValidator();
  private readonly prismaGen = new PrismaSchemaGenerator();
  private readonly resourceGen = new ResourceDefinitionGenerator();
  private readonly policyGen = new PolicyGenerator();
  private readonly testGen = new TestGenerator();
  private readonly seederGen = new SeederGenerator();

  async run(options: RunnerOptions = {}): Promise<RunnerResult> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const blueprintsDir = path.join(projectRoot, '.rhino', 'blueprints');
    const manifestDir = path.join(projectRoot, '.rhino');

    const result: RunnerResult = {
      processed: [],
      skipped: [],
      errors: [],
      generatedFiles: [],
    };

    // Discover YAML files
    if (!fs.existsSync(blueprintsDir)) {
      this.log(`No blueprints directory found at ${blueprintsDir}`, options);
      return result;
    }

    // Filter rules:
    //   - .yaml / .yml only
    //   - Skip files whose basename starts with `_` — those are shared anchor /
    //     partial files (e.g. `_roles.yaml`) that are imported into other
    //     blueprints but are not themselves model definitions. See BP-009.
    const yamlFiles = fs
      .readdirSync(blueprintsDir)
      .filter((f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'))
      .sort();

    if (yamlFiles.length === 0) {
      this.log('No blueprint YAML files found.', options);
      return result;
    }

    const manifest = new ManifestManager(manifestDir);

    // Order so a referenced model is processed before any model that
    // foreign-keys to it (parents before children) — keeps order-sensitive
    // output (e.g. seeders) runnable and matches the Laravel/Rails stacks, where
    // migration timestamps follow this order.
    const sorter = new BlueprintSorter();
    const parsedForOrder: Array<{ file: string; blueprint: any }> = [];
    const unparseable: string[] = [];
    for (const f of yamlFiles) {
      try {
        parsedForOrder.push({ file: f, blueprint: this.parser.parseModel(path.join(blueprintsDir, f)) });
      } catch {
        unparseable.push(f);
      }
    }
    const orderedBlueprints = sorter.sort(parsedForOrder.map((p) => p.blueprint));
    const fileByModel = new Map<string, string>();
    for (const p of parsedForOrder) {
      if (!fileByModel.has(p.blueprint.model)) {
        fileByModel.set(p.blueprint.model, p.file);
      }
    }
    const orderedYamlFiles = [
      ...orderedBlueprints.map((bp) => fileByModel.get(bp.model)!).filter(Boolean),
      ...unparseable,
    ];
    if (sorter.cycles.length > 0) {
      this.log(
        `  ⚠ Circular foreign-key dependency among: ${sorter.cycles.join(', ')}. ` +
          'Order is best-effort — make one side nullable or add the FK in a later step.',
        options,
      );
    }

    for (const filename of orderedYamlFiles) {
      const filePath = path.join(blueprintsDir, filename);

      try {
        // Parse
        const blueprint = this.parser.parseModel(filePath);

        // Filter by --model flag
        if (options.model && blueprint.model.toLowerCase() !== options.model.toLowerCase()) {
          result.skipped.push(filename);
          continue;
        }

        // Validate
        const validation = this.validator.validate(blueprint);
        if (!validation.valid) {
          const msg = validation.errors.join('; ');
          result.errors.push({ file: filename, error: msg });
          this.log(`  ✗ ${filename}: ${msg}`, options);
          continue;
        }

        if (validation.warnings.length > 0) {
          this.log(`  ⚠ ${filename} warnings: ${validation.warnings.join('; ')}`, options);
        }

        // Check manifest (skip unchanged unless --force)
        const hash = this.parser.computeFileHash(filePath);
        if (!options.force && !manifest.hasChanged(filename, hash)) {
          result.skipped.push(filename);
          this.log(`  → ${filename} unchanged, skipping`, options);
          continue;
        }

        // Generate
        this.log(`  ↻ ${filename} (${blueprint.model})`, options);

        const generated = this.generateAll(blueprint, projectRoot, options.dryRun ?? false);
        result.generatedFiles.push(...generated);
        result.processed.push(filename);

        // Record in manifest
        if (!options.dryRun) {
          manifest.recordGeneration(filename, hash, generated);
        }
      } catch (err: any) {
        result.errors.push({ file: filename, error: err.message });
        this.log(`  ✗ ${filename}: ${err.message}`, options);
      }
    }

    // Save manifest
    if (!options.dryRun && result.processed.length > 0) {
      manifest.save();
    }

    this.log(
      `\nBlueprint run complete: ${result.processed.length} processed, ` +
        `${result.skipped.length} skipped, ${result.errors.length} errors.`,
      options,
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private generateAll(
    blueprint: import('./blueprint-parser').Blueprint,
    projectRoot: string,
    dryRun: boolean,
  ): string[] {
    const generated: string[] = [];
    const model = blueprint.model;

    // 1. Prisma schema fragment — appended to prisma/schema.prisma.
    //    BP-002: skip when the model already exists in the consumer's
    //    schema (hand-authored). Detect SQLite provider so decimals map to
    //    Float instead of unsupported Decimal.
    const prismaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
    const existingSchema = fs.existsSync(prismaPath) ? fs.readFileSync(prismaPath, 'utf8') : '';
    const provider = detectPrismaProvider(existingSchema);
    const prismaFragment = this.prismaGen.generate(blueprint, { existingSchema, provider });
    if (prismaFragment && !dryRun) {
      this.appendToFile(prismaPath, `\n${prismaFragment}\n`);
    }
    if (prismaFragment) generated.push(prismaPath);

    // 2. Resource definition file
    const resourcePath = path.join(projectRoot, 'src', 'resources', `${model}Resource.ts`);
    const resourceContent = this.resourceGen.generate(blueprint);
    if (!dryRun) {
      this.writeFile(resourcePath, resourceContent);
    }
    generated.push(resourcePath);

    // 3. Policy class
    const policyPath = path.join(projectRoot, 'src', 'policies', `${model}Policy.ts`);
    const policyContent = this.policyGen.generate(blueprint);
    if (!dryRun) {
      this.writeFile(policyPath, policyContent);
    }
    generated.push(policyPath);

    // 4. Jest test file
    const testPath = path.join(projectRoot, 'test', 'generated', `${model}.spec.ts`);
    const testContent = this.testGen.generate(blueprint);
    if (!dryRun) {
      this.writeFile(testPath, testContent);
    }
    generated.push(testPath);

    // 5. Seeder
    const seederPath = path.join(projectRoot, 'src', 'seeders', `${model}Seeder.ts`);
    const seederContent = this.seederGen.generate(blueprint);
    if (!dryRun) {
      this.writeFile(seederPath, seederContent);
    }
    generated.push(seederPath);

    return generated;
  }

  private writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }

  private appendToFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, content, 'utf8');
  }

  private log(message: string, options: RunnerOptions): void {
    if (!options.silent) {
      console.log(message);
    }
  }
}

/**
 * Parse the Prisma datasource provider out of an existing schema. Defaults
 * to `postgresql` when the block is missing or unrecognised. Used so that
 * the schema generator emits `Float` instead of `Decimal` on SQLite.
 */
export function detectPrismaProvider(schema: string): 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'mongodb' {
  const m = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/m);
  const found = (m?.[1] ?? '').toLowerCase();
  switch (found) {
    case 'sqlite':
    case 'postgresql':
    case 'mysql':
    case 'sqlserver':
    case 'mongodb':
      return found;
    default:
      return 'postgresql';
  }
}
