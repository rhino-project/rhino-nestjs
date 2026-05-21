import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ManifestManager } from './manifest-manager';

// ---------------------------------------------------------------------------
// ManifestManager
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  return dir;
}

describe('ManifestManager', () => {
  it('starts with an empty manifest when directory has no manifest.json', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    const m = manager.getManifest();
    expect(m.version).toBe(1);
    expect(m.generated_at).toBeNull();
    expect(m.files).toEqual({});
  });

  it('hasChanged returns true for a new (untracked) file', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    expect(manager.hasChanged('post.yaml', 'abc123')).toBe(true);
  });

  it('hasChanged returns false after recording the same hash', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'abc123', []);
    expect(manager.hasChanged('post.yaml', 'abc123')).toBe(false);
  });

  it('hasChanged returns true when hash differs from stored', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'abc123', []);
    expect(manager.hasChanged('post.yaml', 'different-hash')).toBe(true);
  });

  it('recordGeneration stores hash and generated files', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'deadbeef', ['src/policies/PostPolicy.ts']);
    const m = manager.getManifest();
    expect(m.files['post.yaml']).toMatchObject({
      content_hash: 'deadbeef',
      generated_files: ['src/policies/PostPolicy.ts'],
    });
    expect(m.files['post.yaml'].generated_at).toBeTruthy();
    expect(m.generated_at).toBeTruthy();
  });

  it('getGeneratedFiles returns empty array for untracked file', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    expect(manager.getGeneratedFiles('unknown.yaml')).toEqual([]);
  });

  it('getGeneratedFiles returns stored files', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'h', ['file1.ts', 'file2.ts']);
    expect(manager.getGeneratedFiles('post.yaml')).toEqual(['file1.ts', 'file2.ts']);
  });

  it('getTrackedFiles lists all recorded filenames', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'h1', []);
    manager.recordGeneration('article.yaml', 'h2', []);
    const tracked = manager.getTrackedFiles();
    expect(tracked).toContain('post.yaml');
    expect(tracked).toContain('article.yaml');
    expect(tracked).toHaveLength(2);
  });

  it('removeTracking removes an entry', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'h', []);
    manager.removeTracking('post.yaml');
    expect(manager.getTrackedFiles()).not.toContain('post.yaml');
  });

  it('save persists manifest to disk and reload returns same data', () => {
    const dir = makeTmpDir();
    const manager = new ManifestManager(dir);
    manager.recordGeneration('post.yaml', 'abc', ['src/PostPolicy.ts']);
    manager.save();

    // Reload from disk
    const manager2 = new ManifestManager(dir);
    expect(manager2.hasChanged('post.yaml', 'abc')).toBe(false);
    expect(manager2.getGeneratedFiles('post.yaml')).toEqual(['src/PostPolicy.ts']);
  });

  it('save creates the directory if it does not exist', () => {
    const base = makeTmpDir();
    const nested = path.join(base, 'deep', 'dir');
    const manager = new ManifestManager(nested);
    manager.recordGeneration('post.yaml', 'h', []);
    expect(() => manager.save()).not.toThrow();
    expect(fs.existsSync(path.join(nested, 'manifest.json'))).toBe(true);
  });

  it('loads gracefully from a corrupt manifest.json', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'NOT JSON', 'utf8');
    const manager = new ManifestManager(dir);
    expect(manager.getManifest().files).toEqual({});
  });
});
