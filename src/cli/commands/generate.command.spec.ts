import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runGenerate } from './generate.command';
import type { ReadlineInterface } from '../utils/prompt';

// -----------------------------------------------------------------------
// Fake readline
// -----------------------------------------------------------------------
function mockRl(answers: string[]): ReadlineInterface {
  const queue = [...answers];
  return {
    question(_q: string, cb: (a: string) => void) {
      setImmediate(() => cb(queue.shift() ?? ''));
    },
    close: jest.fn(),
  };
}

describe('runGenerate', () => {
  let tmpDir: string;
  let consoleSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-gen-'));
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Model
  // -----------------------------------------------------------------------
  it('generates a model stub with columns', async () => {
    // selectFromList shows options, user picks "1" (model), name="Post", columns=...
    const rl = mockRl(['1', 'Post', 'title:string, body:text, published:boolean']);
    await runGenerate({ rl, cwd: tmpDir });

    const filePath = path.join(tmpDir, 'src', 'models', 'Post.model.ts');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('class Post');
    expect(content).toContain('title?:');
    expect(content).toContain('body?:');
    expect(content).toContain('published?:');
  });

  it('generates a model stub without columns', async () => {
    const rl = mockRl(['1', 'Article', '']);
    await runGenerate({ rl, cwd: tmpDir });

    const filePath = path.join(tmpDir, 'src', 'models', 'Article.model.ts');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('class Article');
  });

  it('converts kebab-case name to PascalCase', async () => {
    const rl = mockRl(['1', 'blog-post', '']);
    await runGenerate({ rl, cwd: tmpDir });

    const filePath = path.join(tmpDir, 'src', 'models', 'BlogPost.model.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Policy
  // -----------------------------------------------------------------------
  it('generates a policy stub', async () => {
    const rl = mockRl(['2', 'Post']);
    await runGenerate({ rl, cwd: tmpDir });

    const filePath = path.join(tmpDir, 'src', 'policies', 'Post.policy.ts');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('class PostPolicy extends ResourcePolicy');
  });

  // -----------------------------------------------------------------------
  // Scope
  // -----------------------------------------------------------------------
  it('generates a scope stub', async () => {
    const rl = mockRl(['3', 'Post']);
    await runGenerate({ rl, cwd: tmpDir });

    const filePath = path.join(tmpDir, 'src', 'scopes', 'Post.scope.ts');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('class PostScope implements RhinoScope');
  });

  // -----------------------------------------------------------------------
  // File already exists
  // -----------------------------------------------------------------------
  it('skips generation when file already exists', async () => {
    const filePath = path.join(tmpDir, 'src', 'models', 'Post.model.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '// existing');

    const rl = mockRl(['1', 'Post', '']);
    await runGenerate({ rl, cwd: tmpDir });

    // File content should be unchanged
    expect(fs.readFileSync(filePath, 'utf8')).toBe('// existing');
  });
});
