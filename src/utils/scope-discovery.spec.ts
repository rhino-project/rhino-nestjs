import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { autoDiscoverScopes } from './scope-discovery';

function makeTempScopesDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-scopes-'));
}

describe('autoDiscoverScopes', () => {
  it('returns config unchanged when scopesDir does not exist', () => {
    const config: any = { models: { posts: { model: 'post' } } };
    const out = autoDiscoverScopes(config, { scopesDir: '/nonexistent' });
    expect(out.models.posts.scopes).toBeUndefined();
  });

  it('discovers a default-exported scope class', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(
      path.join(dir, 'PostScope.js'),
      `module.exports = class PostScope {
         apply(where) { return { ...where, isActive: true }; }
       };`,
    );
    const config: any = { models: { posts: { model: 'post' } } };
    const out = autoDiscoverScopes(config, { scopesDir: dir, extensions: ['.js'] });
    expect(out.models.posts.scopes).toHaveLength(1);
    const ScopeClass = out.models.posts.scopes![0];
    const instance = new (ScopeClass as any)();
    expect(instance.apply({})).toEqual({ isActive: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('discovers via named export matching {ModelName}Scope', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(
      path.join(dir, 'TaskScope.js'),
      `exports.TaskScope = class TaskScope {
         apply(w) { return { ...w, done: false }; }
       };`,
    );
    const out = autoDiscoverScopes(
      { models: { tasks: { model: 'task' } } } as any,
      { scopesDir: dir, extensions: ['.js'] },
    );
    expect(out.models.tasks.scopes).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges with pre-existing scopes (no duplicates)', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(
      path.join(dir, 'PostScope.js'),
      `module.exports = class PostScope { apply(w) { return w; } };`,
    );
    class ManualScope { apply(w: any) { return w; } }
    const out = autoDiscoverScopes(
      { models: { posts: { model: 'post', scopes: [ManualScope] } } } as any,
      { scopesDir: dir, extensions: ['.js'] },
    );
    expect(out.models.posts.scopes).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('silent: true swallows require errors', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(path.join(dir, 'BadScope.js'), 'throw new Error("boom");');
    const out = autoDiscoverScopes(
      { models: { bad: { model: 'bad' } } } as any,
      { scopesDir: dir, extensions: ['.js'], silent: true },
    );
    expect(out.models.bad.scopes).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('silent: false re-throws require errors', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(path.join(dir, 'BadScope.js'), 'throw new Error("boom");');
    expect(() =>
      autoDiscoverScopes(
        { models: { bad: { model: 'bad' } } } as any,
        { scopesDir: dir, extensions: ['.js'], silent: false },
      ),
    ).toThrow(/boom/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not mutate the input config', () => {
    const dir = makeTempScopesDir();
    fs.writeFileSync(
      path.join(dir, 'PostScope.js'),
      `module.exports = class PostScope { apply(w) { return w; } };`,
    );
    const input: any = { models: { posts: { model: 'post' } } };
    autoDiscoverScopes(input, { scopesDir: dir, extensions: ['.js'] });
    expect(input.models.posts.scopes).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
