import { QueryBuilderService } from './query-builder.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

class BlacklistPolicy {
  hiddenAttributesForShow(): string[] {
    return ['salary', 'ssn'];
  }
  permittedAttributesForShow(): string[] {
    return ['*'];
  }
}

class WhitelistPolicy {
  hiddenAttributesForShow(): string[] {
    return [];
  }
  permittedAttributesForShow(): string[] {
    return ['id', 'name'];
  }
}

const reg: ModelRegistration = {
  model: 'employee',
  allowedFilters: ['name', 'salary'],
  allowedSorts: ['name', 'salary'],
  allowedSearch: ['name', 'ssn'],
  policy: BlacklistPolicy as any,
};

describe('Policy-gated filters, sorts and search', () => {
  let qb: QueryBuilderService;

  beforeEach(() => {
    qb = new QueryBuilderService();
  });

  it('refuses to filter by a hidden attribute', () => {
    expect(() => qb.build({ filter: { salary: '300000' } }, reg)).toThrow(
      "Filter 'salary' is not allowed",
    );
  });

  it('refuses to sort by a hidden attribute', () => {
    expect(() => qb.build({ sort: '-salary' }, reg)).toThrow("Sort 'salary' is not allowed");
  });

  it('applies the same gate to a whitelist policy', () => {
    const gated = { ...reg, policy: WhitelistPolicy as any };
    expect(() => qb.build({ filter: { salary: '1' } }, gated)).toThrow(
      "Filter 'salary' is not allowed",
    );
  });

  it('still filters and sorts by a visible attribute', () => {
    const q = qb.build({ filter: { name: 'Alice' }, sort: 'name' }, reg);
    expect(q.where).toEqual({ name: 'Alice' });
    expect(q.orderBy).toEqual([{ name: 'asc' }]);
  });

  it('ignores a column the model never allowlisted rather than refusing it', () => {
    const q = qb.build({ filter: { ssn: '111' } }, reg);
    expect(q.where).toEqual({});
  });

  it('searches only the columns this user may see', () => {
    const q = qb.build({ search: 'needle' }, reg);
    expect(q.where.OR).toEqual([{ name: { contains: 'needle', mode: 'insensitive' } }]);
  });

  it('matches nothing when every searchable column is hidden', () => {
    const secret: ModelRegistration = { ...reg, allowedSearch: ['ssn'] };
    const q = qb.build({ search: 'needle' }, secret);
    expect(q.where.OR).toEqual([]);
  });

  it('leaves everything alone when the model has no policy', () => {
    const open: ModelRegistration = { ...reg, policy: undefined };
    const q = qb.build({ filter: { salary: '1' }, search: 'needle', sort: '-salary' }, open);
    expect(q.where.salary).toBe('1');
    expect(q.where.OR).toHaveLength(2);
    expect(q.orderBy).toEqual([{ salary: 'desc' }]);
  });

  it('does not gate the model default sort', () => {
    const defaulted: ModelRegistration = { ...reg, defaultSort: '-salary' };
    const q = qb.build({}, defaulted);
    expect(q.orderBy).toEqual([{ salary: 'desc' }]);
  });
});
