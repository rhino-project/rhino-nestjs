import * as ts from 'typescript';
import { generateTypeScriptTypes } from './typescript-exporter';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

// ---------------------------------------------------------------------------
// Helper: parse via TypeScript compiler API
// ---------------------------------------------------------------------------

function parseTypeScript(source: string): { diagnostics: ts.Diagnostic[]; hasErrors: boolean } {
  const sourceFile = ts.createSourceFile('rhino.d.ts', source, ts.ScriptTarget.ES2020, true);
  // Walk the AST; any parse errors appear as diagnostics on the source file.
  // We deliberately use a minimal host so we don't need the full TS toolchain.
  const diagnostics = (sourceFile as any).parseDiagnostics ?? [];
  return { diagnostics, hasErrors: diagnostics.length > 0 };
}

/**
 * Compile the source string as an ambient module declaration and collect
 * semantic + syntactic diagnostics.  Returns true when there are no errors.
 */
function compileAndCheck(source: string): boolean {
  const fileName = 'rhino.d.ts';
  const compilerHost: ts.CompilerHost = {
    getSourceFile(name, languageVersion) {
      if (name === fileName) {
        return ts.createSourceFile(name, source, languageVersion, true);
      }
      // Return undefined for lib files — we accept "cannot find lib" but not syntax errors
      return undefined;
    },
    writeFile: () => undefined,
    getDefaultLibFileName: opts => ts.getDefaultLibFileName(opts),
    useCaseSensitiveFileNames: () => false,
    getCanonicalFileName: f => f,
    getCurrentDirectory: () => '',
    getNewLine: () => '\n',
    fileExists: name => name === fileName,
    readFile: () => undefined,
    resolveModuleNames: undefined,
    directoryExists: () => true,
    getDirectories: () => [],
  };

  const program = ts.createProgram([fileName], { noLib: true, noEmit: true }, compilerHost);
  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  // Filter out errors about missing lib files — those are expected with noLib:true
  const realErrors = Array.from(allDiagnostics).filter(
    d =>
      d.category === ts.DiagnosticCategory.Error &&
      // TS2304 = "Cannot find name" (lib globals) — acceptable in noLib mode
      d.code !== 2304 &&
      // TS2318 = "Cannot find global type" — acceptable in noLib mode
      d.code !== 2318 &&
      // TS2688 = "Cannot find type definition file" — acceptable in noLib mode
      d.code !== 2688,
  );

  return realErrors.length === 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTypeScriptTypes', () => {
  // ---- empty config --------------------------------------------------------

  describe('empty config', () => {
    const output = generateTypeScriptTypes({ models: {} });

    it('produces a non-empty string', () => {
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });

    it('includes the auto-generated header comment', () => {
      expect(output).toContain('auto-generated');
    });

    it('includes Paginated<T> generic', () => {
      expect(output).toContain('Paginated<T>');
    });

    it('includes ApiResponse<T> generic', () => {
      expect(output).toContain('ApiResponse<T>');
    });

    it('includes Permission type', () => {
      expect(output).toContain('Permission');
    });

    it('exports RhinoModels as never when no models are registered', () => {
      expect(output).toContain('RhinoModels = never');
    });

    it('parses as valid TypeScript without syntax errors', () => {
      const { hasErrors } = parseTypeScript(output);
      expect(hasErrors).toBe(false);
    });

    it('passes the full TypeScript compiler check', () => {
      expect(compileAndCheck(output)).toBe(true);
    });
  });

  // ---- custom header -------------------------------------------------------

  it('uses a custom header when provided in options', () => {
    const output = generateTypeScriptTypes({ models: {} }, { header: '// My custom header' });
    expect(output.startsWith('// My custom header')).toBe(true);
    expect(output).not.toContain('auto-generated');
  });

  // ---- single model with allowedFields -------------------------------------

  describe('model with allowedFields', () => {
    const config: RhinoConfig = {
      models: {
        posts: {
          model: 'post',
          allowedFields: ['id', 'title', 'body', 'published_at', 'author_id'],
        },
      },
    };
    const output = generateTypeScriptTypes(config);

    it('exports a Posts interface', () => {
      expect(output).toContain('export interface Posts');
    });

    it('includes each allowedField as a property', () => {
      expect(output).toContain('id:');
      expect(output).toContain('title:');
      expect(output).toContain('body:');
      expect(output).toContain('published_at:');
      expect(output).toContain('author_id:');
    });

    it('types each field as string | number | boolean | null', () => {
      expect(output).toContain('string | number | boolean | null');
    });

    it('adds posts to RhinoModels union', () => {
      expect(output).toContain("RhinoModels = 'posts'");
    });

    it('is valid TypeScript', () => {
      expect(compileAndCheck(output)).toBe(true);
    });
  });

  // ---- model without allowedFields — minimal fallback ----------------------

  describe('model without allowedFields', () => {
    const config: RhinoConfig = {
      models: {
        tags: { model: 'tag' },
      },
    };
    const output = generateTypeScriptTypes(config);

    it('still emits a Tags interface', () => {
      expect(output).toContain('export interface Tags');
    });

    it('includes an id property as fallback', () => {
      // minimal fallback body has at least an id field
      expect(output).toContain('id:');
    });

    it('is valid TypeScript', () => {
      expect(compileAndCheck(output)).toBe(true);
    });
  });

  // ---- query interface with allowedFilters ---------------------------------

  describe('model with allowedFilters', () => {
    const config: RhinoConfig = {
      models: {
        articles: {
          model: 'article',
          allowedFilters: ['status', 'author_id'],
          allowedSorts: ['createdAt', 'updatedAt'],
          allowedSearch: ['title'],
          allowedIncludes: ['author', 'tags'],
        },
      },
    };
    const output = generateTypeScriptTypes(config);

    it('exports an ArticlesQuery interface', () => {
      expect(output).toContain('export interface ArticlesQuery');
    });

    it('includes filter properties for each allowedFilter', () => {
      expect(output).toContain("'filter[status]'");
      expect(output).toContain("'filter[author_id]'");
    });

    it('includes a sort property with literal types for each allowedSort', () => {
      expect(output).toContain("sort?:");
      expect(output).toContain("'createdAt'");
      expect(output).toContain("'-createdAt'");
    });

    it('includes a search property when allowedSearch is set', () => {
      expect(output).toContain('search?: string');
    });

    it('includes an include property with literal union when allowedIncludes is set', () => {
      expect(output).toContain("include?:");
      expect(output).toContain("'author'");
      expect(output).toContain("'tags'");
    });

    it('includes pagination properties', () => {
      expect(output).toContain('page?: number');
      expect(output).toContain('per_page?: number');
    });

    it('is valid TypeScript', () => {
      expect(compileAndCheck(output)).toBe(true);
    });
  });

  // ---- no query interface when no query hints ------------------------------

  it('does not emit a Query interface when no query hints are provided', () => {
    const config: RhinoConfig = {
      models: { posts: { model: 'post' } },
    };
    const output = generateTypeScriptTypes(config);
    expect(output).not.toContain('PostsQuery');
  });

  // ---- multiple models — union type ----------------------------------------

  describe('multiple models', () => {
    const config: RhinoConfig = {
      models: {
        posts: { model: 'post' },
        comments: { model: 'comment' },
        tags: { model: 'tag' },
      },
    };
    const output = generateTypeScriptTypes(config);

    it('exports all three model interfaces', () => {
      expect(output).toContain('export interface Posts');
      expect(output).toContain('export interface Comments');
      expect(output).toContain('export interface Tags');
    });

    it('includes all three slugs in the RhinoModels union', () => {
      expect(output).toContain("'posts'");
      expect(output).toContain("'comments'");
      expect(output).toContain("'tags'");
    });

    it('RhinoModels uses type keyword', () => {
      expect(output).toContain('export type RhinoModels');
    });

    it('is valid TypeScript', () => {
      expect(compileAndCheck(output)).toBe(true);
    });
  });

  // ---- slug → PascalCase conversion ----------------------------------------

  it('converts kebab-case slugs to PascalCase interface names', () => {
    const config: RhinoConfig = {
      models: { 'blog-posts': { model: 'blogPost' } },
    };
    const output = generateTypeScriptTypes(config);
    expect(output).toContain('export interface BlogPosts');
  });

  it('converts snake_case slugs to PascalCase interface names', () => {
    const config: RhinoConfig = {
      models: { user_profiles: { model: 'userProfile' } },
    };
    const output = generateTypeScriptTypes(config);
    expect(output).toContain('export interface UserProfiles');
  });

  // ---- paginationEnabled: false --------------------------------------------

  it('omits pagination fields from Query interface when paginationEnabled is false', () => {
    const config: RhinoConfig = {
      models: {
        settings: {
          model: 'setting',
          allowedFilters: ['key'],
          paginationEnabled: false,
        },
      },
    };
    const output = generateTypeScriptTypes(config);
    expect(output).toContain('export interface SettingsQuery');
    expect(output).not.toContain('page?: number');
    expect(output).not.toContain('per_page?: number');
  });
});
