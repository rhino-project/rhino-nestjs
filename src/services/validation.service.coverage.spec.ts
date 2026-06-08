import { ValidationService } from './validation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../rhino.config';

// Coverage for cross-tenant FK validation (verifyTenantFks / isFkInOrg /
// walkFkChainForRecord — BP-004). No production code changes.
describe('ValidationService.verifyTenantFks — coverage', () => {
  const cfg = (models: any) => new RhinoConfigService(normalizeConfig({ models }));
  const postReg = { model: 'post', fkConstraints: [{ field: 'projectId', model: 'project' }] } as any;

  it('is valid when there is no organization context (nothing to check)', async () => {
    const svc = new ValidationService();
    const r = await svc.verifyTenantFks({ projectId: 5 }, postReg, undefined);
    expect(r.valid).toBe(true);
  });

  it('is valid when the model declares no FK constraints', async () => {
    const svc = new ValidationService(new PrismaService({}), cfg({}));
    const r = await svc.verifyTenantFks({}, { model: 'post' } as any, { id: 1 });
    expect(r.valid).toBe(true);
  });

  it('skips a constraint whose value is null', async () => {
    const findFirst = jest.fn();
    const svc = new ValidationService(
      new PrismaService({ project: { findFirst } }),
      cfg({ projects: { model: 'project', belongsToOrganization: true } }),
    );
    const r = await svc.verifyTenantFks({ projectId: null }, postReg, { id: 1 });
    expect(r.valid).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fast-path: valid when the referenced record is in the org', async () => {
    const svc = new ValidationService(
      new PrismaService({ project: { findFirst: jest.fn().mockResolvedValue({ id: 5, organizationId: 1 }) } }),
      cfg({ projects: { model: 'project', belongsToOrganization: true } }),
    );
    const r = await svc.verifyTenantFks({ projectId: 5 }, postReg, { id: 1 });
    expect(r.valid).toBe(true);
  });

  it('invalid (with field error) when the referenced record is in a different org', async () => {
    const svc = new ValidationService(
      new PrismaService({ project: { findFirst: jest.fn().mockResolvedValue(null) } }),
      cfg({ projects: { model: 'project', belongsToOrganization: true } }),
    );
    const r = await svc.verifyTenantFks({ projectId: 5 }, postReg, { id: 1 });
    expect(r.valid).toBe(false);
    expect(r.errors?.projectId).toBeTruthy();
  });

  it('walks the FK chain (comment → task → project) and validates the ancestor org', async () => {
    const svc = new ValidationService(
      new PrismaService({
        task: {
          findFirst: jest.fn().mockResolvedValue(null), // task has no organizationId
          findUnique: jest.fn().mockResolvedValue({ id: 10, projectId: 5 }),
        },
        project: { findFirst: jest.fn().mockResolvedValue({ id: 5, organizationId: 1 }) },
      }),
      cfg({
        comments: { model: 'comment', fkConstraints: [{ field: 'taskId', model: 'task' }] },
        tasks: { model: 'task', fkConstraints: [{ field: 'projectId', model: 'project' }] },
        projects: { model: 'project', belongsToOrganization: true },
      }),
    );
    const reg = { model: 'comment', fkConstraints: [{ field: 'taskId', model: 'task' }] } as any;
    const r = await svc.verifyTenantFks({ taskId: 10 }, reg, { id: 1 });
    expect(r.valid).toBe(true);
  });

  it('chain walk is invalid when the ancestor is not in the org', async () => {
    const svc = new ValidationService(
      new PrismaService({
        task: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue({ id: 10, projectId: 5 }),
        },
        project: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
      cfg({
        comments: { model: 'comment', fkConstraints: [{ field: 'taskId', model: 'task' }] },
        tasks: { model: 'task', fkConstraints: [{ field: 'projectId', model: 'project' }] },
        projects: { model: 'project', belongsToOrganization: true },
      }),
    );
    const reg = { model: 'comment', fkConstraints: [{ field: 'taskId', model: 'task' }] } as any;
    const r = await svc.verifyTenantFks({ taskId: 10 }, reg, { id: 1 });
    expect(r.valid).toBe(false);
  });
});
