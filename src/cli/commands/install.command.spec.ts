import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInstall } from './install.command';
import type { ReadlineInterface } from '../utils/prompt';

// -----------------------------------------------------------------------
// Fake readline that answers questions in order
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

describe('runInstall', () => {
  let tmpDir: string;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-install-'));
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('happy path: creates setup stub, skips multi-tenant, skips audit, skips skills', async () => {
    // Answers: create stub? yes, multi-tenant? no, audit trail? no, skills? no
    const rl = mockRl(['y', 'n', 'n', 'n']);

    await runInstall({ rl, cwd: tmpDir });

    const stubPath = path.join(tmpDir, 'src', 'rhino.setup.ts');
    expect(fs.existsSync(stubPath)).toBe(true);
    const content = fs.readFileSync(stubPath, 'utf8');
    expect(content).toContain('rhinoConfig');
    expect(content).toContain('enabled: false');
  });

  it('skips setup stub when user answers no', async () => {
    // no to stub, no to multi-tenant, no to audit, no to skills
    const rl = mockRl(['n', 'n', 'n', 'n']);
    await runInstall({ rl, cwd: tmpDir });

    const stubPath = path.join(tmpDir, 'src', 'rhino.setup.ts');
    expect(fs.existsSync(stubPath)).toBe(false);
  });

  it('enables multi-tenant and uses provided org column', async () => {
    // yes to stub, yes to multi-tenant, column=slug, no to audit, no to skills
    const rl = mockRl(['y', 'y', 'slug', 'n', 'n']);
    await runInstall({ rl, cwd: tmpDir });

    const stubPath = path.join(tmpDir, 'src', 'rhino.setup.ts');
    const content = fs.readFileSync(stubPath, 'utf8');
    expect(content).toContain('enabled: true');
    expect(content).toContain("organizationIdentifierColumn: 'slug'");
  });

  it('appends AuditLog snippet to prisma/schema.prisma', async () => {
    // Create existing schema
    const schemaDir = path.join(tmpDir, 'prisma');
    fs.mkdirSync(schemaDir, { recursive: true });
    const schemaPath = path.join(schemaDir, 'schema.prisma');
    fs.writeFileSync(schemaPath, 'model User { id Int @id }');

    // yes to stub, no to multi-tenant, yes to audit, no to skills
    const rl = mockRl(['y', 'n', 'y', 'n']);
    await runInstall({ rl, cwd: tmpDir });

    const content = fs.readFileSync(schemaPath, 'utf8');
    expect(content).toContain('AuditLog');
  });

  it('does not duplicate AuditLog if already present', async () => {
    const schemaDir = path.join(tmpDir, 'prisma');
    fs.mkdirSync(schemaDir, { recursive: true });
    const schemaPath = path.join(schemaDir, 'schema.prisma');
    const existing =
      'model User { id Int @id }\nmodel AuditLog { id Int @id }';
    fs.writeFileSync(schemaPath, existing);

    const rl = mockRl(['y', 'n', 'y', 'n']);
    await runInstall({ rl, cwd: tmpDir });

    const content = fs.readFileSync(schemaPath, 'utf8');
    const count = (content.match(/AuditLog/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('installs skill files from the provided source dir', async () => {
    // Create a fake skills source dir with two files
    const skillsDir = path.join(tmpDir, 'fake-skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'rhino-feature.md'),
      '# Feature skill',
    );
    fs.writeFileSync(
      path.join(skillsDir, 'rhino-review.md'),
      '# Review skill',
    );

    // yes to stub, no to multi-tenant, no to audit, yes to skills
    const rl = mockRl(['y', 'n', 'n', 'y']);
    await runInstall({ rl, cwd: tmpDir, skillsSourceDir: skillsDir });

    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    expect(fs.existsSync(path.join(commandsDir, 'rhino-feature.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(commandsDir, 'rhino-review.md'))).toBe(
      true,
    );
  });

  it('skips skills gracefully when source dir is missing', async () => {
    // yes to stub, no to multi-tenant, no to audit, yes to skills
    const rl = mockRl(['y', 'n', 'n', 'y']);
    await runInstall({
      rl,
      cwd: tmpDir,
      skillsSourceDir: path.join(tmpDir, 'nonexistent-skills'),
    });
    // No .claude/commands dir should be created with skill files
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    // The dir may be created, but there should be no md files
    if (fs.existsSync(commandsDir)) {
      const files = fs.readdirSync(commandsDir);
      expect(files.length).toBe(0);
    }
  });
});
