/**
 * Thin filesystem helpers for the CLI.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Return true when a file (or directory) exists. */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Write content to a file, creating parent directories as needed.
 * Writes to a tmp path first then renames for an atomic-ish write.
 */
export function writeFileSafely(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp_${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Append `content` to `filePath` only when the exact string is not
 * already present (prevents duplicate entries on re-runs).
 */
export function appendIfMissing(filePath: string, content: string): void {
  if (fileExists(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.includes(content.trim())) return;
    fs.appendFileSync(filePath, `\n${content}`, 'utf8');
  } else {
    writeFileSafely(filePath, content);
  }
}
