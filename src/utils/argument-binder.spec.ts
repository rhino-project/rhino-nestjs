import { RhinoException } from '../errors/rhino-exception';
import { bindArguments, coerceArgument } from './argument-binder';
import {
  computedAttributeRequiresArguments,
  isComputedAttributeSpec,
  lookupComputedAttribute,
  normalizeComputedAttribute,
} from './computed-attribute-spec';

/**
 * The binder is shared by named scopes and computed attributes. These tests pin
 * BOTH subjects: the algorithm must behave identically, and each feature must
 * keep its own error wording.
 */
describe('bindArguments', () => {
  const computed = (name: string, params: string[], optional: string[], raw: any) =>
    bindArguments({ subject: 'Computed attribute', name, params, optional, raw });

  function forbidden(fn: () => any, message: string) {
    let caught: any;
    try {
      fn();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RhinoException);
    expect(caught.getStatus()).toBe(403);
    expect((caught.getResponse() as any).message).toBe(message);
  }

  describe('happy paths', () => {
    it('binds no arguments for a blank raw value', () => {
      expect(computed('headcount', [], [], '')).toEqual({});
      expect(computed('headcount', [], [], null)).toEqual({});
      expect(computed('headcount', [], [], undefined)).toEqual({});
    });

    it('binds a bare value to the single declared parameter', () => {
      expect(computed('since', ['from'], [], '2026-01-01')).toEqual({ from: '2026-01-01' });
    });

    it('binds named arguments by name', () => {
      expect(computed('revenue', ['from', 'to'], [], { to: 'b', from: 'a' })).toEqual({
        from: 'a',
        to: 'b',
      });
    });

    it('omits an omitted optional parameter from the args object', () => {
      expect(computed('revenue', ['from', 'to'], ['to'], { from: 'a' })).toEqual({ from: 'a' });
    });

    it('omits every parameter when all are optional and none were sent', () => {
      expect(computed('tone', ['tone'], ['tone'], '')).toEqual({});
    });

    it('coerces "true" and "false" to real booleans, case-insensitively', () => {
      expect(computed('flagged', ['on'], [], 'true')).toEqual({ on: true });
      expect(computed('flagged', ['on'], [], 'FALSE')).toEqual({ on: false });
      expect(computed('flagged', ['on'], [], 'yes')).toEqual({ on: 'yes' });
    });

    it('never coerces parameter names', () => {
      expect(computed('weird', ['true'], [], { true: 'x' })).toEqual({ true: 'x' });
    });

    it('leaves non-strings alone when coercing', () => {
      expect(coerceArgument(3)).toBe(3);
      expect(coerceArgument(null)).toBeNull();
    });

    it('matches parameter names verbatim', () => {
      forbidden(
        () => computed('revenue', ['from_date'], [], { fromDate: 'x' }),
        "Computed attribute 'revenue' does not accept parameter 'fromDate'",
      );
    });
  });

  describe('the four argument errors under the Computed attribute subject', () => {
    it('names a missing required parameter', () => {
      forbidden(
        () => computed('revenue', ['from', 'to'], [], { from: 'a' }),
        "Computed attribute 'revenue' requires parameter 'to'",
      );
    });

    it('names an unknown parameter', () => {
      forbidden(
        () => computed('revenue', ['from', 'to'], [], { from: 'a', to: 'b', nope: 'x' }),
        "Computed attribute 'revenue' does not accept parameter 'nope'",
      );
    });

    it('refuses a bare value for a multi-parameter attribute', () => {
      forbidden(
        () => computed('revenue', ['from', 'to'], [], '2026-01-01'),
        "Computed attribute 'revenue' requires named parameters",
      );
    });

    it('refuses a positional argument list', () => {
      forbidden(
        () => computed('revenue', ['from', 'to'], [], ['a', 'b']),
        "Computed attribute 'revenue' requires named parameters",
      );
    });

    it('refuses a non-scalar argument value', () => {
      forbidden(
        () => computed('revenue', ['from', 'to'], [], { from: { deep: 1 }, to: 'b' }),
        "Computed attribute 'revenue' requires named parameters",
      );
    });

    it('refuses any argument sent to a parameterless attribute', () => {
      forbidden(
        () => computed('headcount', [], [], '5'),
        "Computed attribute 'headcount' does not accept arguments",
      );
      forbidden(
        () => computed('headcount', [], [], { from: 'a' }),
        "Computed attribute 'headcount' does not accept arguments",
      );
    });

    it('refuses a prototype key as an argument name', () => {
      // qs strips these before the controller, but a different parser must not
      // be able to reach a prototype member.
      forbidden(
        () => computed('revenue', ['from'], [], { constructor: 'x' }),
        "Computed attribute 'revenue' does not accept parameter 'constructor'",
      );
      forbidden(
        () => computed('revenue', ['from'], [], JSON.parse('{"__proto__": "x", "from": "a"}')),
        "Computed attribute 'revenue' does not accept parameter '__proto__'",
      );
    });
  });

  describe('the scope subject is unchanged by the extraction', () => {
    const scope = (name: string, params: string[], optional: string[], raw: any) =>
      bindArguments({ subject: 'Scope', name, params, optional, raw });

    it('still says Scope in every message', () => {
      forbidden(
        () => scope('window', ['from', 'to'], [], { from: 'a' }),
        "Scope 'window' requires parameter 'to'",
      );
      forbidden(
        () => scope('window', ['from'], [], { nope: 'a' }),
        "Scope 'window' does not accept parameter 'nope'",
      );
      forbidden(
        () => scope('window', ['from', 'to'], [], 'a'),
        "Scope 'window' requires named parameters",
      );
      forbidden(() => scope('window', [], [], 'a'), "Scope 'window' does not accept arguments");
    });
  });
});

/**
 * The declaration-detection rule. A value is an extended spec if and only if it
 * is a plain object carrying params/optionalParams/using. Everything else stays
 * a LEGACY declaration — that is what keeps `version: 3` and `tags: ['a','b']`
 * literal values rather than silently becoming parameter lists.
 */
describe('computed-attribute spec detection', () => {
  it('keeps a function declaration legacy', () => {
    const fn = () => 1;
    expect(normalizeComputedAttribute(fn)).toEqual({ params: [], optional: [], using: fn });
  });

  it('keeps a scalar literal declaration legacy', () => {
    expect(normalizeComputedAttribute(3)).toEqual({ params: [], optional: [], using: 3 });
    expect(normalizeComputedAttribute('v3')).toEqual({ params: [], optional: [], using: 'v3' });
    expect(normalizeComputedAttribute(null)).toEqual({ params: [], optional: [], using: null });
  });

  it('keeps an array a literal, NOT a parameter list', () => {
    // This is why computed attributes deliberately have no array shorthand:
    // ['a','b'] is a legal value today.
    expect(normalizeComputedAttribute(['a', 'b'])).toEqual({
      params: [],
      optional: [],
      using: ['a', 'b'],
    });
  });

  it('keeps an object without the reserved keys a literal', () => {
    const literal = { color: 'red', size: 2 };
    expect(normalizeComputedAttribute(literal)).toEqual({
      params: [],
      optional: [],
      using: literal,
    });
  });

  it('treats an object carrying params as an extended spec', () => {
    const fn = () => 1;
    expect(normalizeComputedAttribute({ params: ['from', 'to'], using: fn })).toEqual({
      params: ['from', 'to'],
      optional: [],
      using: fn,
    });
  });

  it('treats an object carrying only using as an extended spec with no parameters', () => {
    const fn = () => 1;
    expect(normalizeComputedAttribute({ using: fn })).toEqual({
      params: [],
      optional: [],
      using: fn,
    });
  });

  it('discards optionalParams entries that are not declared parameters', () => {
    expect(
      normalizeComputedAttribute({ params: ['from', 'to'], optionalParams: ['to', 'ghost'] })
        .optional,
    ).toEqual(['to']);
  });

  it('detects specs correctly', () => {
    expect(isComputedAttributeSpec('x')).toBe(false);
    expect(isComputedAttributeSpec(3)).toBe(false);
    expect(isComputedAttributeSpec(null)).toBe(false);
    expect(isComputedAttributeSpec(undefined)).toBe(false);
    expect(isComputedAttributeSpec(['a'])).toBe(false);
    expect(isComputedAttributeSpec({ color: 'red' })).toBe(false);
    expect(isComputedAttributeSpec(() => 1)).toBe(false);
    expect(isComputedAttributeSpec({ params: [] })).toBe(true);
    expect(isComputedAttributeSpec({ optionalParams: [] })).toBe(true);
    expect(isComputedAttributeSpec({ using: () => 1 })).toBe(true);
  });

  it('requires arguments only when a parameter is mandatory', () => {
    expect(computedAttributeRequiresArguments({ params: [], optional: [], using: null })).toBe(
      false,
    );
    expect(
      computedAttributeRequiresArguments({ params: ['a'], optional: ['a'], using: null }),
    ).toBe(false);
    expect(computedAttributeRequiresArguments({ params: ['a'], optional: [], using: null })).toBe(
      true,
    );
    expect(
      computedAttributeRequiresArguments({ params: ['a', 'b'], optional: ['b'], using: null }),
    ).toBe(true);
  });

  describe('lookupComputedAttribute', () => {
    it('resolves an own key', () => {
      expect(lookupComputedAttribute({ total: 3 }, 'total')).toEqual({
        params: [],
        optional: [],
        using: 3,
      });
    });

    it('never resolves a prototype key', () => {
      expect(lookupComputedAttribute({ total: 3 }, 'constructor')).toBeUndefined();
      expect(lookupComputedAttribute({ total: 3 }, '__proto__')).toBeUndefined();
      expect(lookupComputedAttribute({ total: 3 }, 'toString')).toBeUndefined();
      expect(lookupComputedAttribute({ total: 3 }, 'hasOwnProperty')).toBeUndefined();
    });

    it('returns undefined for an undeclared name or a missing declaration', () => {
      expect(lookupComputedAttribute({ total: 3 }, 'nope')).toBeUndefined();
      expect(lookupComputedAttribute(undefined, 'total')).toBeUndefined();
    });
  });
});
