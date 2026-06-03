import {
  validateRouteGroups,
  RouteGroupConflictError,
} from './route-group-validator';
import { normalizeConfig } from '../rhino.config';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

// Route groups that would silently shadow each other must throw at
// config-normalization (boot) time. A group's routing identity is
// (host-set, prefix) per model; two groups conflict when their host-sets
// intersect, they share a prefix, and their models overlap.

const MODELS = { posts: {} as any, categories: {} as any };

function cfg(routeGroups: RhinoConfig['routeGroups']): RhinoConfig {
  return { models: MODELS, routeGroups } as RhinoConfig;
}

describe('validateRouteGroups', () => {
  // ----------------------------------------------------------------
  // Must throw
  // ----------------------------------------------------------------
  describe('throws RouteGroupConflictError', () => {
    it('two root groups without a domain', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', models: '*' },
            b: { prefix: '', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('wildcard models overlapping a subset at root', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', models: '*' },
            b: { prefix: '', models: ['posts'] },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('same non-empty prefix without a domain', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: 'admin', models: '*' },
            b: { prefix: 'admin', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('same prefix and same literal domain', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', domain: 'app.example.com', models: '*' },
            b: { prefix: '', domain: 'app.example.com', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('same prefix and same parameterized domain', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', domain: '{organization}.example.com', models: '*' },
            b: { prefix: '', domain: '{organization}.example.com', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('a no-domain catch-all conflicts with a domained group (wildcard host)', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            catchAll: { prefix: '', models: '*' },
            admin: { prefix: '', domain: 'admin.example.com', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('a blank domain does not rescue a root collision', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', domain: '', models: '*' },
            b: { prefix: '', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('an omitted prefix collides with an explicit root prefix', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { models: '*' },
            b: { prefix: '', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('names only the conflicting pair among several groups', () => {
      let message = '';
      try {
        validateRouteGroups(
          cfg({
            driver: { prefix: 'driver', models: '*' },
            a: { prefix: '', models: ['posts'] },
            admin: { prefix: 'admin', models: '*' },
            b: { prefix: '', models: ['posts'] },
          }),
        );
        fail('expected RouteGroupConflictError');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain("'a'");
      expect(message).toContain("'b'");
      expect(message).not.toContain("'driver'");
      expect(message).not.toContain("'admin'");
    });

    it('names the shared prefix and overlapping models', () => {
      let message = '';
      try {
        validateRouteGroups(
          cfg({
            first: { prefix: 'shared', models: ['posts'] },
            second: { prefix: 'shared', models: ['posts'] },
          }),
        );
        fail('expected RouteGroupConflictError');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain("'first'");
      expect(message).toContain("'second'");
      expect(message).toContain('shared');
      expect(message).toContain('posts');
    });
  });

  // ----------------------------------------------------------------
  // Must NOT throw
  // ----------------------------------------------------------------
  describe('does not throw for valid configurations', () => {
    it('disjoint models at root without a domain', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', models: ['posts'] },
            b: { prefix: '', models: ['categories'] },
          }),
        ),
      ).not.toThrow();
    });

    it('same prefix with distinct literal domains', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            us: { prefix: '', domain: 'us.example.com', models: '*' },
            eu: { prefix: '', domain: 'eu.example.com', models: '*' },
          }),
        ),
      ).not.toThrow();
    });

    it('distinct parameterized domains at the same prefix', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: '', domain: '{organization}.a.example.com', models: '*' },
            b: { prefix: '', domain: '{organization}.b.example.com', models: '*' },
          }),
        ),
      ).not.toThrow();
    });

    it('the same domain with different prefixes', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            a: { prefix: 'v1', domain: 'api.example.com', models: '*' },
            b: { prefix: 'v2', domain: 'api.example.com', models: '*' },
          }),
        ),
      ).not.toThrow();
    });

    it('different prefixes without domains', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            driver: { prefix: 'driver', models: '*' },
            admin: { prefix: 'admin', models: '*' },
          }),
        ),
      ).not.toThrow();
    });

    it('a single root group without a domain', () => {
      expect(() =>
        validateRouteGroups(cfg({ default: { prefix: '', models: '*' } })),
      ).not.toThrow();
    });

    it('a single group with a domain and a root (empty) prefix', () => {
      // Headline requirement: with a subdomain, the prefix is not required.
      expect(() =>
        validateRouteGroups(
          cfg({
            tenant: {
              prefix: '',
              domain: '{organization}.example.com',
              models: '*',
            },
          }),
        ),
      ).not.toThrow();
    });

    it('tenant and public groups with distinct prefixes', () => {
      expect(() =>
        validateRouteGroups(
          cfg({
            tenant: { prefix: ':organization', models: '*' },
            public: { prefix: 'public', models: ['posts'], skipAuth: true },
          }),
        ),
      ).not.toThrow();
    });

    it('no route groups configured', () => {
      expect(() => validateRouteGroups(cfg({}))).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // Integration: normalizeConfig runs the validation at boot
  // ----------------------------------------------------------------
  describe('normalizeConfig integration', () => {
    it('throws when normalizing a conflicting config', () => {
      expect(() =>
        normalizeConfig(
          cfg({
            a: { prefix: '', models: '*' },
            b: { prefix: '', models: '*' },
          }),
        ),
      ).toThrow(RouteGroupConflictError);
    });

    it('normalizes a valid config without throwing', () => {
      expect(() =>
        normalizeConfig(
          cfg({
            us: { prefix: '', domain: 'us.example.com', models: '*' },
            eu: { prefix: '', domain: 'eu.example.com', models: '*' },
          }),
        ),
      ).not.toThrow();
    });
  });
});
