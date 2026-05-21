import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Manifest shape
// ---------------------------------------------------------------------------

interface ManifestEntry {
  content_hash: string;
  generated_files: string[];
  generated_at: string;
}

interface ManifestData {
  version: number;
  generated_at: string | null;
  files: Record<string, ManifestEntry>;
}

// ---------------------------------------------------------------------------
// ManifestManager
// ---------------------------------------------------------------------------

/**
 * Tracks SHA-256 hashes of blueprint files in `.rhino/manifest.json`
 * so unchanged files are skipped on re-generation.
 */
export class ManifestManager {
  private readonly manifestPath: string;
  private manifest: ManifestData;

  constructor(blueprintsDir: string) {
    // Store manifest alongside blueprints under .rhino/manifest.json
    this.manifestPath = path.join(blueprintsDir, 'manifest.json');
    this.manifest = this.load();
  }

  /**
   * Check whether a blueprint file has changed since the last generation run.
   *
   * @param filename     The blueprint filename (e.g. 'post.yaml')
   * @param currentHash  SHA-256 of the current file contents
   * @returns true if the file is new or its hash differs from the stored one
   */
  hasChanged(filename: string, currentHash: string): boolean {
    const entry = this.manifest.files[filename];
    if (!entry) return true; // new file
    return entry.content_hash !== currentHash;
  }

  /**
   * Record a successful generation run for a blueprint file.
   *
   * @param filename       The blueprint filename
   * @param contentHash    SHA-256 of the file at generation time
   * @param generatedFiles Paths to all files produced by the generators
   */
  recordGeneration(filename: string, contentHash: string, generatedFiles: string[]): void {
    this.manifest.files[filename] = {
      content_hash: contentHash,
      generated_files: generatedFiles,
      generated_at: new Date().toISOString(),
    };
    this.manifest.generated_at = new Date().toISOString();
  }

  /**
   * Return the list of files that were generated the last time a blueprint was processed.
   */
  getGeneratedFiles(filename: string): string[] {
    return this.manifest.files[filename]?.generated_files ?? [];
  }

  /**
   * Return all blueprint filenames currently tracked in the manifest.
   */
  getTrackedFiles(): string[] {
    return Object.keys(this.manifest.files);
  }

  /**
   * Remove a blueprint entry from the manifest (use when the source YAML is deleted).
   */
  removeTracking(filename: string): void {
    delete this.manifest.files[filename];
  }

  /**
   * Persist the manifest to disk.
   * Creates the parent directory if it does not exist.
   */
  save(): void {
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2) + '\n', 'utf8');
  }

  /**
   * Return the full in-memory manifest (useful for testing / debugging).
   */
  getManifest(): ManifestData {
    return this.manifest;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private load(): ManifestData {
    const empty: ManifestData = { version: 1, generated_at: null, files: {} };

    if (!fs.existsSync(this.manifestPath)) return empty;

    try {
      const raw = fs.readFileSync(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as ManifestData;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      // corrupt manifest — start fresh
    }

    return empty;
  }
}
