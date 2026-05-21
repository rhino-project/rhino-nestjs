import { findOrganizationFkChain } from './fk-chain-walker';

describe('findOrganizationFkChain', () => {
  it('finds a direct chain when model has organizationId column', () => {
    const chain = findOrganizationFkChain('post', {
      getRelations: (m) =>
        m === 'post'
          ? [{ localColumn: 'projectId', foreignModel: 'project', foreignColumn: 'id' }]
          : [],
      hasOrganizationId: (m) => m === 'project',
      maxDepth: 3,
    });
    expect(chain).toHaveLength(1);
    expect(chain![0].leadsToOrg).toBe(true);
  });

  it('walks deep chains up to maxDepth', () => {
    // comment -> task -> project (has organizationId)
    const chain = findOrganizationFkChain('comment', {
      getRelations: (m) => {
        if (m === 'comment') return [{ localColumn: 'taskId', foreignModel: 'task', foreignColumn: 'id' }];
        if (m === 'task') return [{ localColumn: 'projectId', foreignModel: 'project', foreignColumn: 'id' }];
        return [];
      },
      hasOrganizationId: (m) => m === 'project',
      maxDepth: 5,
    });
    expect(chain).toHaveLength(2);
    expect(chain![0].foreignModel).toBe('task');
    expect(chain![1].leadsToOrg).toBe(true);
  });

  it('returns null when no chain exists', () => {
    const chain = findOrganizationFkChain('tag', {
      getRelations: () => [],
      hasOrganizationId: () => false,
    });
    expect(chain).toBeNull();
  });

  it('guards against cycles', () => {
    const chain = findOrganizationFkChain('a', {
      getRelations: (m) => {
        if (m === 'a') return [{ localColumn: 'bId', foreignModel: 'b', foreignColumn: 'id' }];
        if (m === 'b') return [{ localColumn: 'aId', foreignModel: 'a', foreignColumn: 'id' }];
        return [];
      },
      hasOrganizationId: () => false,
      maxDepth: 10,
    });
    expect(chain).toBeNull();
  });
});
