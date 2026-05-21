import 'reflect-metadata';
import {
  RhinoModel,
  BelongsToOrganization,
  HasAuditTrail,
  HasUuid,
  HasSoftDeletes,
  ExceptActions,
  HidableColumns,
  getRhinoModelMetadata,
} from './index';

describe('model decorators', () => {
  it('@RhinoModel registers metadata', () => {
    @RhinoModel({ slug: 'posts', model: 'post' })
    class Post {}
    const meta = getRhinoModelMetadata(Post);
    expect(meta).toMatchObject({ slug: 'posts', model: 'post' });
  });

  it('decorators compose flags additively', () => {
    @RhinoModel({ slug: 'posts', model: 'post' })
    @BelongsToOrganization()
    @HasAuditTrail(['password'])
    @HasUuid()
    @HasSoftDeletes()
    @ExceptActions(['destroy'])
    @HidableColumns(['secret'])
    class Post {}
    const meta = getRhinoModelMetadata(Post)!;
    expect(meta.belongsToOrganization).toBe(true);
    expect(meta.hasAuditTrail).toBe(true);
    expect(meta.auditExclude).toEqual(['password']);
    expect(meta.hasUuid).toBe(true);
    expect(meta.softDeletes).toBe(true);
    expect(meta.exceptActions).toEqual(['destroy']);
    expect(meta.additionalHiddenColumns).toEqual(['secret']);
  });
});
