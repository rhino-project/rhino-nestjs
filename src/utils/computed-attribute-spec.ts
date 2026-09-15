/**
 * Declaration handling for computed attributes.
 *
 * A declared value is an EXTENDED SPEC if and only if it is a plain object
 * carrying at least one of `params`, `optionalParams` or `using`. Anything else
 * — a function, a scalar, an array, an object without those keys — is a LEGACY
 * declaration and behaves exactly as it does today.
 *
 * Unlike named scopes, there is deliberately no string or array shorthand: a
 * declared value that is not a function is a *literal* today, and adopting the
 * scope shorthands would silently reinterpret shipped declarations.
 *
 * LEAF module: no service imports (see utils/argument-binder).
 */
export interface NormalizedComputedSpec {
  params: string[];
  optional: string[];
  /** The callable, or the literal value for a legacy declaration. */
  using: any;
}

const SPEC_KEYS = ['params', 'optionalParams', 'using'] as const;

/** Whether a declared value is an extended spec. */
export function isComputedAttributeSpec(value: any): boolean {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  return SPEC_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Normalize one declared value into `{ params, optional, using }`. */
export function normalizeComputedAttribute(value: any): NormalizedComputedSpec {
  if (!isComputedAttributeSpec(value)) {
    return { params: [], optional: [], using: value };
  }

  const params = Array.isArray(value.params) ? value.params.map(String) : [];
  const optionalRaw = Array.isArray(value.optionalParams)
    ? value.optionalParams.map(String)
    : [];

  return {
    params,
    // An `optionalParams` entry that is not a declared parameter is meaningless.
    optional: optionalRaw.filter((name: string) => params.includes(name)),
    using: value.using,
  };
}

/**
 * Look a declaration up by name with an OWN-key check, so `constructor` or
 * `__proto__` can never resolve to a prototype member. Returns undefined when
 * the name is not declared.
 */
export function lookupComputedAttribute(
  declared: Record<string, any> | undefined,
  name: string,
): NormalizedComputedSpec | undefined {
  if (!declared || typeof name !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(declared, name)) return undefined;
  return normalizeComputedAttribute(declared[name]);
}

/**
 * Whether the attribute declares at least one parameter the client MUST supply.
 * Such attributes are skipped — never 403'd — when no selection was made (a
 * bare `GET /computed`) and when a direct serializer call passes no arguments.
 */
export function computedAttributeRequiresArguments(spec: NormalizedComputedSpec): boolean {
  return spec.params.some((param) => !spec.optional.includes(param));
}
