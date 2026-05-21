import { RhinoException } from './rhino-exception';

describe('RhinoException', () => {
  it('validationFailed → 422 with VALIDATION_FAILED code + errors in details', () => {
    const e = RhinoException.validationFailed({ title: ['required'] });
    expect(e.getStatus()).toBe(422);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { errors: { title: ['required'] } },
    });
  });

  it('forbiddenFields → 403 with FORBIDDEN_FIELDS + fields list', () => {
    const e = RhinoException.forbiddenFields(['budget']);
    expect(e.getStatus()).toBe(403);
    expect(e.code).toBe('FORBIDDEN_FIELDS');
    expect(e.getResponse()).toMatchObject({
      code: 'FORBIDDEN_FIELDS',
      details: { fields: ['budget'] },
    });
  });

  it('crossTenant → 422 with CROSS_TENANT code', () => {
    const e = RhinoException.crossTenant({ projectId: ['not in org'] });
    expect(e.getStatus()).toBe(422);
    expect(e.code).toBe('CROSS_TENANT');
  });

  it('unauthorized → 401 UNAUTHORIZED', () => {
    const e = RhinoException.unauthorized();
    expect(e.getStatus()).toBe(401);
    expect(e.code).toBe('UNAUTHORIZED');
  });

  it('notFound → 404 NOT_FOUND', () => {
    const e = RhinoException.notFound();
    expect(e.getStatus()).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });

  it('actionDisabled includes the action name', () => {
    const e = RhinoException.actionDisabled('destroy');
    expect(e.code).toBe('ACTION_DISABLED');
    expect(e.getResponse()).toMatchObject({ details: { action: 'destroy' } });
  });

  it('unknownResource includes the slug', () => {
    const e = RhinoException.unknownResource('widgets');
    expect(e.code).toBe('UNKNOWN_RESOURCE');
    expect(e.getResponse()).toMatchObject({ details: { slug: 'widgets' } });
  });

  it('includeNotAuthorized → 403 with slug in details', () => {
    const e = RhinoException.includeNotAuthorized('secrets');
    expect(e.getStatus()).toBe(403);
    expect(e.code).toBe('INCLUDE_NOT_AUTHORIZED');
    expect(e.getResponse()).toMatchObject({ details: { slug: 'secrets' } });
  });

  it('custom construction preserves all fields', () => {
    const e = new RhinoException('INVITATION_EXPIRED', 'gone', 410, { age: 8 });
    expect(e.getStatus()).toBe(410);
    expect(e.code).toBe('INVITATION_EXPIRED');
    expect(e.getResponse()).toEqual({
      code: 'INVITATION_EXPIRED',
      message: 'gone',
      details: { age: 8 },
    });
  });
});
