import { z } from 'zod';
import { defineModel } from './model-builder';
import { ResourcePolicy } from '../policies/resource-policy';

class PostPolicy extends ResourcePolicy {}
class PostScope { apply(w: any) { return w; } }

describe('defineModel', () => {
  it('maps features to flat flags', () => {
    const reg = defineModel({
      model: 'post',
      features: { multiTenant: true, softDeletes: true, auditTrail: true, uuid: true },
    });
    expect(reg).toMatchObject({
      model: 'post',
      belongsToOrganization: true,
      softDeletes: true,
      hasAuditTrail: true,
      hasUuid: true,
    });
  });

  it('maps query subsection to flat allowed* keys', () => {
    const reg = defineModel({
      model: 'post',
      query: {
        filters: ['status'],
        sorts: ['-createdAt'],
        defaultSort: '-createdAt',
        search: ['title'],
        includes: ['author'],
        fields: ['id', 'title'],
        pagination: false,
        perPage: 50,
      },
    });
    expect(reg).toMatchObject({
      allowedFilters: ['status'],
      allowedSorts: ['-createdAt'],
      defaultSort: '-createdAt',
      allowedSearch: ['title'],
      allowedIncludes: ['author'],
      allowedFields: ['id', 'title'],
      paginationEnabled: false,
      perPage: 50,
    });
  });

  it('maps validation subsection', () => {
    const base = z.object({ title: z.string() });
    const reg = defineModel({ model: 'post', validation: { base } });
    expect(reg.validation).toBe(base);
  });

  it('maps response subsection', () => {
    const reg = defineModel({
      model: 'post',
      response: {
        hidden: ['internalNotes'],
        computed: (r) => ({ upper: String(r.title ?? '').toUpperCase() }),
      },
    });
    expect(reg.additionalHiddenColumns).toEqual(['internalNotes']);
    expect(reg.computedAttributes?.({ title: 'a' }, {})).toEqual({ upper: 'A' });
  });

  it('maps restrict.except → exceptActions', () => {
    const reg = defineModel({ model: 'post', restrict: { except: ['destroy'] } });
    expect(reg.exceptActions).toEqual(['destroy']);
  });

  it('passes through scopes and fkConstraints', () => {
    const reg = defineModel({
      model: 'post',
      scopes: [PostScope],
      fkConstraints: [{ field: 'projectId', model: 'project' }],
    });
    expect(reg.scopes).toEqual([PostScope]);
    expect(reg.fkConstraints).toEqual([{ field: 'projectId', model: 'project' }]);
  });

  it('passes through policy reference', () => {
    const reg = defineModel({ model: 'post', policy: PostPolicy });
    expect(reg.policy).toBe(PostPolicy);
  });

  it('omits undefined groups cleanly', () => {
    const reg = defineModel({ model: 'post' });
    expect(reg).toEqual({ model: 'post', policy: undefined });
  });
});
