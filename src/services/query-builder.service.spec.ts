import { QueryBuilderService } from './query-builder.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

const reg: ModelRegistration = {
  model: 'post',
  allowedFilters: ['status', 'userId'],
  allowedSorts: ['createdAt', 'title'],
  allowedIncludes: ['author', 'comments.author'],
  allowedSearch: ['title', 'author.name'],
  allowedFields: ['id', 'title', 'status'],
  defaultSort: '-createdAt',
};

describe('QueryBuilderService', () => {
  let qb: QueryBuilderService;
  beforeEach(() => (qb = new QueryBuilderService()));

  it('returns empty where when no filters', () => {
    const q = qb.build({}, reg);
    expect(q.where).toEqual({});
  });

  it('builds an exact match filter', () => {
    const q = qb.build({ filter: { status: 'draft' } }, reg);
    expect(q.where).toEqual({ status: 'draft' });
  });

  it('converts comma-separated values into IN clause', () => {
    const q = qb.build({ filter: { status: 'draft,published' } }, reg);
    expect(q.where).toEqual({ status: { in: ['draft', 'published'] } });
  });

  it('ignores filters not in allowedFilters', () => {
    const q = qb.build({ filter: { secret: 'x', status: 'draft' } }, reg);
    expect(q.where).toEqual({ status: 'draft' });
  });

  it('builds search OR clauses across allowedSearch fields', () => {
    const q = qb.build({ search: 'hello' }, reg);
    expect(q.where.OR).toHaveLength(2);
    expect(q.where.OR[0]).toEqual({ title: { contains: 'hello', mode: 'insensitive' } });
    expect(q.where.OR[1]).toEqual({
      author: { is: { name: { contains: 'hello', mode: 'insensitive' } } },
    });
  });

  it('parses default sort when no sort param', () => {
    const q = qb.build({}, reg);
    expect(q.orderBy).toEqual([{ createdAt: 'desc' }]);
  });

  it('parses comma-separated sorts with direction markers', () => {
    const q = qb.build({ sort: '-createdAt,title' }, reg);
    expect(q.orderBy).toEqual([{ createdAt: 'desc' }, { title: 'asc' }]);
  });

  it('rejects sort fields not in allowedSorts', () => {
    expect(() => qb.build({ sort: 'unknown' }, reg)).toThrow(/Sort not allowed/);
  });

  it('builds nested include map', () => {
    const q = qb.build({ include: 'comments.author,author' }, reg);
    expect(q.include).toEqual({
      comments: { include: { author: true } },
      author: true,
    });
  });

  it('rejects includes not in allowedIncludes', () => {
    expect(() => qb.build({ include: 'secret' }, reg)).toThrow(/Include not allowed/);
  });

  it('builds select with id always included', () => {
    const q = qb.build({ fields: { posts: 'title,status' } }, reg);
    expect(q.select).toEqual({ id: true, title: true, status: true });
  });

  it('rejects fields not in allowedFields', () => {
    expect(() => qb.build({ fields: { posts: 'internal' } }, reg)).toThrow(/Field not allowed/);
  });

  it('parses pagination params', () => {
    const q = qb.build({ per_page: '10', page: '3' }, reg);
    expect(q.perPage).toBe(10);
    expect(q.page).toBe(3);
  });

  it('ignores bad pagination values', () => {
    const q = qb.build({ per_page: 'abc', page: '0' }, reg);
    expect(q.perPage).toBeUndefined();
    expect(q.page).toBeUndefined();
  });
});
