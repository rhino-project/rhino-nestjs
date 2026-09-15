import { generatePostmanCollection } from './postman-exporter';
import type { RhinoConfig } from '../interfaces/rhino-config.interface';

function folder(items: any[], name: string): any {
  return items.find((i: any) => i.name === name);
}

function request(items: any[], model: string, action: string, name: string): any {
  return folder(folder(folder(items, model)?.item ?? [], action)?.item ?? [], name);
}

/** key => value of a request's query params */
function query(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of req?.request?.url?.query ?? []) out[pair.key] = pair.value;
  return out;
}

// Mixes parameterless, single-parameter, multi-parameter and all-optional
// attributes so every branch of the exported request shape is covered.
const config = {
  models: {
    argPosts: {
      model: 'post',
      recordComputedAttributes: {
        wordCount: () => 1,
        labelSince: { params: ['since'], using: () => 1 },
        labelWindow: { params: ['from', 'to'], using: () => 1 },
      },
      collectionComputedAttributes: {
        publishedCount: () => 1,
        draftCount: () => 1,
        statusCount: { params: ['status'], using: () => 1 },
        rangeCount: { params: ['min', 'max'], using: () => 1 },
        optionalCount: { params: ['status'], optionalParams: ['status'], using: () => 1 },
      },
    },
    // Only ONE attribute can be requested without arguments: no combined request.
    oneFreePosts: {
      model: 'post',
      collectionComputedAttributes: {
        totalCount: () => 1,
        statusCount: { params: ['status'], using: () => 1 },
      },
    },
  },
} as unknown as RhinoConfig;

describe('Postman export — computed attribute arguments', () => {
  const items: any[] = (
    generatePostmanCollection(config, { baseUrl: 'http://localhost:3000/api' }) as any
  ).item;

  describe('the Computed Attributes folder', () => {
    it('keeps the plain list form for a parameterless attribute', () => {
      expect(query(request(items, 'argPosts', 'Computed Attributes', 'Computed: publishedCount')))
        .toEqual({ attributes: 'publishedCount' });
    });

    it('uses the bare bracket form for a single-parameter attribute', () => {
      expect(query(request(items, 'argPosts', 'Computed Attributes', 'Computed: statusCount')))
        .toEqual({ 'attributes[statusCount]': 'example' });
    });

    it('uses one key per parameter for a multi-parameter attribute', () => {
      expect(query(request(items, 'argPosts', 'Computed Attributes', 'Computed: rangeCount')))
        .toEqual({
          'attributes[rangeCount][min]': 'example',
          'attributes[rangeCount][max]': 'example',
        });
    });

    it('still uses the bracket form for an all-optional attribute', () => {
      expect(query(request(items, 'argPosts', 'Computed Attributes', 'Computed: optionalCount')))
        .toEqual({ 'attributes[optionalCount]': 'example' });
    });

    it('excludes required-parameter attributes from the combined request', () => {
      // statusCount and rangeCount would be a guaranteed 403 without arguments;
      // optionalCount is safe because its parameter is optional.
      expect(
        query(request(items, 'argPosts', 'Computed Attributes', 'Computed: multiple attributes')),
      ).toEqual({ attributes: 'publishedCount,draftCount,optionalCount' });
    });

    it('leaves the All request with no parameters at all', () => {
      // A bare /computed skips required-parameter attributes server-side, so it
      // stays a valid request.
      expect(query(request(items, 'argPosts', 'Computed Attributes', 'All computed attributes')))
        .toEqual({});
    });

    it('omits the combined request when fewer than two attributes are argument-free', () => {
      const names = folder(folder(items, 'oneFreePosts').item, 'Computed Attributes').item.map(
        (i: any) => i.name,
      );
      expect(names).toContain('Computed: totalCount');
      expect(names).toContain('Computed: statusCount');
      expect(names).not.toContain('Computed: multiple attributes');
    });
  });

  describe('index and show', () => {
    it('exports the bracket form for a parameterised record attribute on index', () => {
      expect(query(request(items, 'argPosts', 'Index', 'With computed attribute wordCount')))
        .toEqual({ computed_attributes: 'wordCount' });
      expect(query(request(items, 'argPosts', 'Index', 'With computed attribute labelSince')))
        .toEqual({ 'computed_attributes[labelSince]': 'example' });
      expect(query(request(items, 'argPosts', 'Index', 'With computed attribute labelWindow')))
        .toEqual({
          'computed_attributes[labelWindow][from]': 'example',
          'computed_attributes[labelWindow][to]': 'example',
        });
    });

    it('exports the bracket form for a parameterised record attribute on show', () => {
      expect(query(request(items, 'argPosts', 'Show', 'Show with computed attribute labelSince')))
        .toEqual({ 'computed_attributes[labelSince]': 'example' });
      expect(query(request(items, 'argPosts', 'Show', 'Show with computed attribute labelWindow')))
        .toEqual({
          'computed_attributes[labelWindow][from]': 'example',
          'computed_attributes[labelWindow][to]': 'example',
        });
    });
  });
});
