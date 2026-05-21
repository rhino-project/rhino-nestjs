import { z } from 'zod';
import { ValidationService } from './validation.service';
import { ResourcePolicy } from '../policies/resource-policy';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

describe('ValidationService', () => {
  let v: ValidationService;
  beforeEach(() => (v = new ValidationService()));

  it('passes through when no schema defined', () => {
    const reg: ModelRegistration = { model: 'x' };
    const res = v.validateForAction({ a: 1 }, reg, { action: 'store' });
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({ a: 1 });
  });

  it('validates against reg.validation schema', () => {
    const schema = z.object({ title: z.string().min(3) });
    const reg: ModelRegistration = { model: 'post', validation: schema };
    const res = v.validateForAction({ title: 'hi' }, reg, { action: 'store' });
    expect(res.valid).toBe(false);
    expect(res.errors?.title).toBeTruthy();
  });

  it('uses validationStore schema when present', () => {
    const reg: ModelRegistration = {
      model: 'post',
      validationStore: z.object({ title: z.string() }),
    };
    const res = v.validateForAction({ title: 'ok' }, reg, { action: 'store' });
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({ title: 'ok' });
  });

  it('role-keyed schemas pick by user role', () => {
    const admin = z.object({ title: z.string(), secret: z.string() });
    const viewer = z.object({ title: z.string() });
    const reg: ModelRegistration = {
      model: 'post',
      validationStore: { admin, viewer, '*': viewer },
    };
    const user = { userRoles: [{ organizationId: 1, role: { slug: 'admin' } }] };
    const res = v.validateForAction(
      { title: 't', secret: 's' },
      reg,
      { action: 'store', user, organization: { id: 1 } },
    );
    expect(res.valid).toBe(true);
  });

  it('falls back to "*" schema when role not matched', () => {
    const wildcard = z.object({ title: z.string() });
    const reg: ModelRegistration = {
      model: 'post',
      validationStore: { admin: z.object({}), '*': wildcard },
    };
    const user = { userRoles: [{ organizationId: 1, role: { slug: 'viewer' } }] };
    const res = v.validateForAction(
      { title: 't' },
      reg,
      { action: 'store', user, organization: { id: 1 } },
    );
    expect(res.valid).toBe(true);
  });

  it('strips organizationId on tenant create', () => {
    const reg: ModelRegistration = { model: 'post' };
    const res = v.validateForAction(
      { title: 't', organizationId: 999 },
      reg,
      { action: 'store', organization: { id: 1 } },
    );
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({ title: 't' });
  });

  it('rejects forbidden fields per policy create allowlist', () => {
    class P extends ResourcePolicy {
      permittedAttributesForCreate() {
        return ['title'];
      }
    }
    const reg: ModelRegistration = {
      model: 'post',
      policy: P,
      validation: z.object({ title: z.string() }),
    };
    const res = v.validateForAction(
      { title: 't', budget: 1000 },
      reg,
      { action: 'store' },
    );
    expect(res.valid).toBe(false);
    expect(res.forbiddenFields).toEqual(['budget']);
  });

  it('narrows schema via pick when policy restricts fields (update)', () => {
    class P extends ResourcePolicy {
      permittedAttributesForUpdate() {
        return ['title'];
      }
    }
    const reg: ModelRegistration = {
      model: 'post',
      policy: P,
      validationUpdate: z.object({ title: z.string(), status: z.string() }),
    };
    // If schema wasn't narrowed, the missing required `status` would fail
    const res = v.validateForAction({ title: 't' }, reg, { action: 'update' });
    expect(res.valid).toBe(true);
  });

  describe('verifyTenantFks', () => {
    const { PrismaService } = require('../prisma/prisma.service');
    const { RhinoConfigService, normalizeConfig } = require('../rhino.config');
    const { ValidationService } = require('./validation.service');

    it('passes when no constraints declared', async () => {
      const svc = new ValidationService();
      const res = await svc.verifyTenantFks({}, { model: 'post' }, { id: 1 });
      expect(res.valid).toBe(true);
    });

    it('passes when value is null', async () => {
      const prisma = new PrismaService({ project: { findFirst: jest.fn() } });
      const config = new RhinoConfigService(normalizeConfig({ models: {} }));
      const svc = new ValidationService(prisma, config);
      const reg = { model: 'post', fkConstraints: [{ field: 'projectId', model: 'project' }] };
      const res = await svc.verifyTenantFks({ projectId: null }, reg, { id: 1 });
      expect(res.valid).toBe(true);
    });

    it('passes when referenced record is in same org', async () => {
      const prisma = new PrismaService({
        project: { findFirst: jest.fn().mockResolvedValue({ id: 5, organizationId: 1 }) },
      });
      const config = new RhinoConfigService(normalizeConfig({ models: {} }));
      const svc = new ValidationService(prisma, config);
      const reg = { model: 'post', fkConstraints: [{ field: 'projectId', model: 'project' }] };
      const res = await svc.verifyTenantFks({ projectId: 5 }, reg, { id: 1 });
      expect(res.valid).toBe(true);
    });

    it('fails when referenced record is in a different org', async () => {
      const prisma = new PrismaService({
        project: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });
      const config = new RhinoConfigService(normalizeConfig({ models: {} }));
      const svc = new ValidationService(prisma, config);
      const reg = { model: 'post', fkConstraints: [{ field: 'projectId', model: 'project' }] };
      const res = await svc.verifyTenantFks({ projectId: 999 }, reg, { id: 1 });
      expect(res.valid).toBe(false);
      expect(res.errors?.projectId).toBeTruthy();
    });
  });

  it('reports detailed zod errors keyed by field path', () => {
    const schema = z.object({
      title: z.string().min(3),
      age: z.number().int(),
    });
    const reg: ModelRegistration = { model: 'x', validation: schema };
    const res = v.validateForAction({ title: 'x', age: 'y' as any }, reg, { action: 'store' });
    expect(res.valid).toBe(false);
    expect(res.errors?.title).toBeTruthy();
    expect(res.errors?.age).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // BP-007 completion: permittedAttributesFor{Create,Update} receive
  // both user AND organization so role-keyed policies can resolve the
  // active role. The original BP-007 fix covered SerializerService only;
  // this path went unnoticed until the TaskFlow reference hit it.
  // -------------------------------------------------------------------
  describe('BP-007 (validation path): org is passed to policy attribute methods', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ResourcePolicy: BasePolicy } = require('../policies/resource-policy');

    class AdminOnlyPolicy extends (BasePolicy as any) {
      permittedAttributesForCreate(user: any, org?: any): string[] {
        if (this.hasRole(user, 'admin', org)) return ['title', 'budget'];
        return [];
      }
      permittedAttributesForUpdate(user: any, org?: any): string[] {
        if (this.hasRole(user, 'admin', org)) return ['title'];
        return [];
      }
    }

    const reg: ModelRegistration = {
      model: 'project',
      policy: AdminOnlyPolicy as any,
      validation: z.object({ title: z.string(), budget: z.number().optional() }),
    };

    const adminOfOrg1 = {
      id: 1,
      userRoles: [{ organizationId: 1, role: { slug: 'admin' }, permissions: ['*'] }],
    };

    it('admin create is ALLOWED when org is threaded through', () => {
      const res = v.validateForAction(
        { title: 'Project A', budget: 100 },
        reg,
        { action: 'store', user: adminOfOrg1, organization: { id: 1 } },
      );
      expect(res.valid).toBe(true);
    });

    it('admin update is ALLOWED when org is threaded through', () => {
      const res = v.validateForAction(
        { title: 'New Title' },
        reg,
        { action: 'update', user: adminOfOrg1, organization: { id: 1 } },
      );
      expect(res.valid).toBe(true);
    });

    it('admin in a DIFFERENT org is rejected (role check fails with wrong org)', () => {
      const res = v.validateForAction(
        { title: 'Project A' },
        reg,
        { action: 'store', user: adminOfOrg1, organization: { id: 99 } },
      );
      expect(res.valid).toBe(false);
      expect(res.forbiddenFields).toContain('title');
    });

    it('omitting organization collapses to "no role" (documents the pre-fix failure mode)', () => {
      const res = v.validateForAction(
        { title: 'Project A' },
        reg,
        { action: 'store', user: adminOfOrg1 }, // no organization
      );
      expect(res.valid).toBe(false);
      expect(res.forbiddenFields).toContain('title');
    });
  });
});
