import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileExists, writeFileSafely, appendIfMissing } from './io';

describe('io utils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // fileExists
  // -----------------------------------------------------------------------
  describe('fileExists', () => {
    it('returns true when file exists', () => {
      const p = path.join(tmpDir, 'exists.txt');
      fs.writeFileSync(p, 'hi');
      expect(fileExists(p)).toBe(true);
    });

    it('returns false when file does not exist', () => {
      expect(fileExists(path.join(tmpDir, 'nope.txt'))).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // writeFileSafely
  // -----------------------------------------------------------------------
  describe('writeFileSafely', () => {
    it('creates a file with given content', () => {
      const p = path.join(tmpDir, 'out.ts');
      writeFileSafely(p, 'export const x = 1;');
      expect(fs.readFileSync(p, 'utf8')).toBe('export const x = 1;');
    });

    it('creates parent directories if missing', () => {
      const p = path.join(tmpDir, 'a', 'b', 'c', 'file.ts');
      writeFileSafely(p, 'hello');
      expect(fs.existsSync(p)).toBe(true);
    });

    it('overwrites an existing file', () => {
      const p = path.join(tmpDir, 'file.ts');
      fs.writeFileSync(p, 'old content');
      writeFileSafely(p, 'new content');
      expect(fs.readFileSync(p, 'utf8')).toBe('new content');
    });
  });

  // -----------------------------------------------------------------------
  // appendIfMissing
  // -----------------------------------------------------------------------
  describe('appendIfMissing', () => {
    it('appends content when file exists and content is absent', () => {
      const p = path.join(tmpDir, 'schema.prisma');
      fs.writeFileSync(p, 'model User { id Int @id }');
      appendIfMissing(p, 'model AuditLog { id Int @id }');
      const content = fs.readFileSync(p, 'utf8');
      expect(content).toContain('model User');
      expect(content).toContain('model AuditLog');
    });

    it('does not duplicate content when already present', () => {
      const snippet = 'model AuditLog { id Int @id }';
      const p = path.join(tmpDir, 'schema.prisma');
      fs.writeFileSync(p, `model User {}\n${snippet}`);
      appendIfMissing(p, snippet);
      const content = fs.readFileSync(p, 'utf8');
      const count = (content.match(/AuditLog/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('creates the file when it does not exist', () => {
      const p = path.join(tmpDir, 'new.prisma');
      appendIfMissing(p, 'model Foo {}');
      expect(fs.readFileSync(p, 'utf8')).toContain('model Foo {}');
    });
  });
});
