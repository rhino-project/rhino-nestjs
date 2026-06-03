import { compileDomain, matchDomain } from './domain-pattern';

describe('compileDomain', () => {
  it('returns null for undefined / null / empty / whitespace patterns', () => {
    expect(compileDomain(undefined)).toBeNull();
    expect(compileDomain(null)).toBeNull();
    expect(compileDomain('')).toBeNull();
    expect(compileDomain('   ')).toBeNull();
  });

  it('compiles a literal domain (not parameterized)', () => {
    const c = compileDomain('admin.example.com')!;
    expect(c).not.toBeNull();
    expect(c.parameterized).toBe(false);
    expect(c.params).toEqual([]);
    expect(c.pattern).toBe('admin.example.com');
  });

  it('compiles a parameterized domain and records param names', () => {
    const c = compileDomain('{organization}.example.com')!;
    expect(c.parameterized).toBe(true);
    expect(c.params).toEqual(['organization']);
  });

  it('supports multiple params', () => {
    const c = compileDomain('{region}.{organization}.example.com')!;
    expect(c.params).toEqual(['region', 'organization']);
  });

  it('trims surrounding whitespace', () => {
    const c = compileDomain('  admin.example.com  ')!;
    expect(c.pattern).toBe('admin.example.com');
  });
});

describe('matchDomain', () => {
  describe('literal domains', () => {
    const c = compileDomain('admin.example.com')!;

    it('matches the exact host', () => {
      expect(matchDomain(c, 'admin.example.com')).toEqual({ params: {} });
    });

    it('matches case-insensitively', () => {
      expect(matchDomain(c, 'ADMIN.Example.COM')).toEqual({ params: {} });
    });

    it('strips a port from the host before matching', () => {
      expect(matchDomain(c, 'admin.example.com:8080')).toEqual({ params: {} });
    });

    it('does not match a different host', () => {
      expect(matchDomain(c, 'app.example.com')).toBeNull();
      expect(matchDomain(c, 'admin.example.org')).toBeNull();
    });

    it('does not match a subdomain of the literal host (anchored)', () => {
      expect(matchDomain(c, 'x.admin.example.com')).toBeNull();
    });

    it('does not partial-match (the dot is escaped)', () => {
      // `adminXexample.com` must not match `admin.example.com`
      expect(matchDomain(c, 'adminXexample.com')).toBeNull();
    });

    it('returns null for null / undefined / empty host', () => {
      expect(matchDomain(c, null)).toBeNull();
      expect(matchDomain(c, undefined)).toBeNull();
      expect(matchDomain(c, '')).toBeNull();
    });
  });

  describe('parameterized domains', () => {
    const c = compileDomain('{organization}.example.com')!;

    it('captures the subdomain label', () => {
      expect(matchDomain(c, 'org-one.example.com')).toEqual({
        params: { organization: 'org-one' },
      });
    });

    it('captures case-insensitively but preserves the captured value casing', () => {
      const result = matchDomain(c, 'Org-One.EXAMPLE.com');
      expect(result?.params.organization).toBe('Org-One');
    });

    it('does NOT match a multi-label subdomain (a label cannot contain a dot)', () => {
      expect(matchDomain(c, 'a.b.example.com')).toBeNull();
    });

    it('does not match the bare apex domain', () => {
      expect(matchDomain(c, 'example.com')).toBeNull();
    });

    it('captures multiple params', () => {
      const multi = compileDomain('{region}.{organization}.example.com')!;
      expect(matchDomain(multi, 'us.acme.example.com')).toEqual({
        params: { region: 'us', organization: 'acme' },
      });
    });
  });
});
