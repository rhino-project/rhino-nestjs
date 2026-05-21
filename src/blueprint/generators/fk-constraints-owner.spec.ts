/**
 * BP-004 — YAML can declare `fk_constraints` + `owner_chain`, and the
 * generators propagate them to ModelRegistration so that cross-tenant FK
 * validation + indirect tenancy work without hand-authored config.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlueprintParser } from '../blueprint-parser';
import { ResourceDefinitionGenerator } from './resource-definition-generator';

function writeYaml(content: string, name = 'bp.yaml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-004-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content, 'utf8');
  return f;
}

describe('BP-004: owner_chain and fk_constraints from YAML', () => {
  const parser = new BlueprintParser();
  const gen = new ResourceDefinitionGenerator();

  // --------------------------------------------------------------------
  // Parser
  // --------------------------------------------------------------------

  describe('parser', () => {
    it('normalizes owner_chain: "task.project" (dot-notated string)', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Comment
options:
  belongs_to_organization: false
  soft_deletes: false
  audit_trail: false
  owner_chain: task.project
columns: {}
permissions: {}
`),
      );
      expect(bp.options.owner_chain).toBe('task.project');
    });

    it('normalizes owner_chain: [task, project] (array)', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Comment
options:
  owner_chain:
    - task
    - project
columns: {}
permissions: {}
`),
      );
      expect(bp.options.owner_chain).toBe('task.project');
    });

    it('owner_chain is null when absent or empty', () => {
      const bp1 = parser.parseModel(
        writeYaml(`
model: Post
columns: {}
permissions: {}
`),
      );
      expect(bp1.options.owner_chain).toBeNull();

      const bp2 = parser.parseModel(
        writeYaml(`
model: Post
options:
  owner_chain: ""
columns: {}
permissions: {}
`),
      );
      expect(bp2.options.owner_chain).toBeNull();
    });

    it('parses fk_constraints in array-of-objects form', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  - field: projectId
    model: project
  - field: assignedTo
    model: user
permissions: {}
`),
      );
      expect(bp.fk_constraints).toEqual([
        { field: 'projectId', model: 'project' },
        { field: 'assignedTo', model: 'user' },
      ]);
    });

    it('parses fk_constraints in object-shorthand form', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  projectId: project
  assignedTo: user
permissions: {}
`),
      );
      expect(bp.fk_constraints).toEqual([
        { field: 'projectId', model: 'project' },
        { field: 'assignedTo', model: 'user' },
      ]);
    });

    it('fk_constraints is an empty array when absent', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Post
options: {}
columns: {}
permissions: {}
`),
      );
      expect(bp.fk_constraints).toEqual([]);
    });

    it('array-form entries missing `field` or `model` are silently dropped', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  - field: projectId
    model: project
  - field: "" # skipped
    model: user
  - model: organization # no field
  - field: orphaned # no model
permissions: {}
`),
      );
      expect(bp.fk_constraints).toEqual([{ field: 'projectId', model: 'project' }]);
    });
  });

  // --------------------------------------------------------------------
  // ResourceDefinitionGenerator
  // --------------------------------------------------------------------

  describe('ResourceDefinitionGenerator', () => {
    it('emits owner: "task.project" into ModelRegistration', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Comment
options:
  owner_chain: task.project
columns: {}
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toContain('owner: "task.project",');
    });

    it('prefers owner_chain over legacy options.owner when both are set', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Comment
options:
  owner: task
  owner_chain: task.project
columns: {}
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toContain('owner: "task.project",');
      expect(out).not.toContain('owner: "task",');
    });

    it('falls back to legacy options.owner when owner_chain is absent', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options:
  owner: project
columns: {}
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toContain('owner: "project",');
    });

    it('emits fkConstraints array into ModelRegistration', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  - field: projectId
    model: project
  - field: assignedTo
    model: user
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).toMatch(
        /fkConstraints:\s*\[\s*\{\s*"field":\s*"projectId",\s*"model":\s*"project"\s*\}\s*,\s*\{\s*"field":\s*"assignedTo",\s*"model":\s*"user"\s*\}\s*\],/,
      );
    });

    it('omits owner + fkConstraints when neither is declared', () => {
      const bp = parser.parseModel(
        writeYaml(`
model: Post
options: {}
columns: {}
permissions: {}
`),
      );
      const out = gen.generate(bp);
      expect(out).not.toContain('owner:');
      expect(out).not.toContain('fkConstraints:');
    });

    it('object-shorthand fk_constraints produces the same output as array form', () => {
      const bp1 = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  projectId: project
permissions: {}
`),
      );
      const bp2 = parser.parseModel(
        writeYaml(`
model: Task
options: {}
columns: {}
fk_constraints:
  - field: projectId
    model: project
permissions: {}
`),
      );
      expect(gen.generate(bp1)).toContain(
        'fkConstraints: [{"field":"projectId","model":"project"}],',
      );
      expect(gen.generate(bp2)).toContain(
        'fkConstraints: [{"field":"projectId","model":"project"}],',
      );
    });
  });
});
