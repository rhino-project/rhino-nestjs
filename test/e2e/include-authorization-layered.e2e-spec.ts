import { buildEnv } from '../helpers/make-controller';
import { ResourcePolicy } from '../../src/policies/resource-policy';

// Include authorization on a DIFFERENTLY-NAMED relation, gated through the REAL
// layered resolver — and the hard-deny fix for includes that don't resolve to a
// registered resource. Mirrors Laravel/Rails: an include is authorized against
// the RELATED MODEL's slug (resolved via the parent's fkConstraints), not the
// relation name; an unresolvable include is denied, never silently allowed.

class PostPolicy extends ResourcePolicy {}
class UserResourcePolicy extends ResourcePolicy {}
class SecretPolicy extends ResourcePolicy {
  viewAny() {
    return false;
  }
}

// A user whose `users.index` permission resolves through the layered model:
// role layer (role.orgRolePermissions) ∪ granted − denied, deny wins.
function layeredUser(
  { role = [] as string[], granted = [] as string[], denied = [] as string[] } = {},
  orgId = 1,
) {
  return {
    id: 1,
    email: 'a@b.c',
    userRoles: [
      {
        organizationId: orgId,
        roleId: 7,
        permissions: [],
        grantedPermissions: granted,
        deniedPermissions: denied,
        role: { id: 7, orgRolePermissions: [{ organizationId: orgId, permissions: role }] },
      },
    ],
  };
}

function ctx(user: any, orgId = 1) {
  return { user, organization: { id: orgId, slug: 'acme' } };
}

// posts.author -> User (relation name differs from model/slug), resolved via
// fkConstraints { field: 'authorId', model: 'user' }.
function cfgWithAuthor(fkField = 'authorId', fkModel = 'user') {
  return {
    models: {
      posts: {
        model: 'post',
        policy: PostPolicy,
        belongsToOrganization: true,
        allowedIncludes: ['author', 'comments'],
        fkConstraints: [{ field: fkField, model: fkModel }],
      },
      users: { model: 'user', policy: UserResourcePolicy },
      comments: { model: 'comment', policy: PostPolicy, belongsToOrganization: true },
    },
  } as any;
}

const onePost = { post: [{ id: 1, title: 'a', organizationId: 1, authorId: 9 }] };

describe('Include authorization — differently-named relation + layered + hard-deny', () => {
  // ── Differently-named relation resolves to the related model via fkConstraints ──

  it('ALLOWS when the role layer grants the related model slug (users.*)', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ role: ['users.*'] })) as any),
    ).resolves.toBeDefined();
  });

  it('DENIES when the user is explicitly denied the related slug (deny wins over role *)', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index(
        'posts',
        { include: 'author' },
        ctx(layeredUser({ role: ['*'], denied: ['users.*'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('DENIES for an exact deny under a role wildcard', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index(
        'posts',
        { include: 'author' },
        ctx(layeredUser({ role: ['*'], denied: ['users.index'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('DENIES by default when no users permission exists anywhere', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ role: ['posts.*'] })) as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('ALLOWS via a per-user grant of the related slug (role lacks it)', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ granted: ['users.index'] })) as any),
    ).resolves.toBeDefined();
  });

  it('resolves a snake_case FK field (author_id)', async () => {
    const env = buildEnv(cfgWithAuthor('author_id'), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ role: ['users.*'] })) as any),
    ).resolves.toBeDefined();
    // and the deny still applies through the resolved slug
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ role: ['*'], denied: ['users.*'] })) as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('resolves when fkConstraints.model is given as the slug instead of the model name', async () => {
    const env = buildEnv(cfgWithAuthor('authorId', 'users'), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'author' }, ctx(layeredUser({ role: ['users.*'] })) as any),
    ).resolves.toBeDefined();
  });

  // ── Hard-deny: includes that DON'T resolve to a registered resource ──

  it('HARD-DENIES an include with no fkConstraint and no matching slug (was silently allowed)', async () => {
    const env = buildEnv(
      {
        models: {
          posts: { model: 'post', policy: PostPolicy, belongsToOrganization: true, allowedIncludes: ['mystery'] },
        },
      } as any,
      onePost,
    );
    await expect(
      env.controllers.global.index('posts', { include: 'mystery' }, ctx(layeredUser({ role: ['*'] })) as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('HARD-DENIES when the FK target model is not registered', async () => {
    const env = buildEnv(
      {
        models: {
          posts: {
            model: 'post',
            policy: PostPolicy,
            belongsToOrganization: true,
            allowedIncludes: ['ghost'],
            fkConstraints: [{ field: 'ghostId', model: 'phantom' }],
          },
        },
      } as any,
      onePost,
    );
    await expect(
      env.controllers.global.index('posts', { include: 'ghost' }, ctx(layeredUser({ role: ['*'] })) as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  // ── Registered-slug includes: existing behavior preserved ──

  it('still authorizes an include whose name IS a registered slug (comments)', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index('posts', { include: 'comments' }, ctx(layeredUser({ role: ['comments.*'] })) as any),
    ).resolves.toBeDefined();
  });

  it('denies a registered-slug include when its policy refuses viewAny', async () => {
    const env = buildEnv(
      {
        models: {
          posts: { model: 'post', policy: PostPolicy, belongsToOrganization: true, allowedIncludes: ['secrets'] },
          secrets: { model: 'secret', policy: SecretPolicy, belongsToOrganization: true },
        },
      } as any,
      onePost,
    );
    await expect(
      env.controllers.global.index('posts', { include: 'secrets' }, ctx(layeredUser({ role: ['*'] })) as any),
    ).rejects.toThrow(/Include not authorized/);
  });

  // ── Edge cases ──

  it('is a no-op when no include is requested', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index('posts', {}, ctx(layeredUser({ role: ['posts.*'] })) as any),
    ).resolves.toBeDefined();
  });

  it('dedupes a repeated include and still denies it once', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index(
        'posts',
        { include: 'author,author' },
        ctx(layeredUser({ role: ['*'], denied: ['users.*'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('authorizes the first segment of a nested include (author.something)', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.index(
        'posts',
        { include: 'author.posts' },
        ctx(layeredUser({ role: ['*'], denied: ['users.*'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('denies the whole request when one of several includes is unauthorized', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    // comments allowed, author denied → overall 403
    await expect(
      env.controllers.global.index(
        'posts',
        { include: 'comments,author' },
        ctx(layeredUser({ role: ['comments.*'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });

  it('show() also enforces include authorization', async () => {
    const env = buildEnv(cfgWithAuthor(), onePost);
    await expect(
      env.controllers.global.show(
        'posts',
        '1',
        { include: 'author' },
        ctx(layeredUser({ role: ['*'], denied: ['users.*'] })) as any,
      ),
    ).rejects.toThrow(/Include not authorized/);
  });
});
