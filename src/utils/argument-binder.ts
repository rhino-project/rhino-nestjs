import { RhinoException } from '../errors/rhino-exception';

/**
 * Binds the arguments a client sent in the bracket query form
 * (`?scope[name][param]=value`, `?attributes[name][param]=value`) to the
 * parameters a model declared.
 *
 * The algorithm is shared by named scopes and computed attributes so the two
 * features cannot drift. The only thing that differs is `subject` — the noun
 * every error message starts with ("Scope", "Computed attribute") — so each
 * feature keeps its own wording while the behavior stays identical.
 *
 * This is a LEAF module: it imports `RhinoException` and nothing else. It must
 * never import a service, or `rhino.config` would pull a service graph in
 * through it (the `DEFAULT_MAX_SCOPES_PER_REQUEST` cycle).
 *
 * Nothing here decides whether a name may be used: callers MUST run the
 * declared-check and the policy-check BEFORE binding, so an argument error can
 * only ever be seen for a name the caller was already allowed to use.
 */
export interface BindArgumentsOptions {
  /** Noun for error messages: 'Scope', 'Computed attribute'. */
  subject: string;
  /** The name the client used, echoed in every message. */
  name: string;
  /** Declared parameter names, in declared order. */
  params?: string[];
  /** Declared parameters the client may omit. */
  optional?: string[];
  /** Whatever the query string produced for the bracket key. */
  raw: any;
}

/**
 * Bind one name's raw value to a named-argument object.
 *
 * Unlike the PHP and Ruby binders — whose callables take positional arguments —
 * the result here is keyed by parameter name, because that is how it reaches a
 * scope (`ctx.args`) or a computed attribute (`ctx.args` / the third parameter).
 * An omitted optional parameter is simply absent from the object.
 */
export function bindArguments(options: BindArgumentsOptions): Record<string, any> {
  const { subject, name, raw } = options;
  const params = Array.isArray(options.params) ? options.params : [];
  const optional = Array.isArray(options.optional) ? options.optional : [];

  let given: Record<string, any>;

  if (raw == null || raw === '') {
    // `?attributes[revenue]=` — no arguments. A name with required parameters
    // still fails below, naming them.
    given = {};
  } else if (Array.isArray(raw)) {
    // A positional list (`?attributes[revenue][]=a`) names nothing. This also
    // catches a repeated key, which `qs` turns into an array.
    throw RhinoException.forbidden(`${subject} '${name}' requires named parameters`);
  } else if (typeof raw !== 'object') {
    if (params.length === 0) {
      throw RhinoException.forbidden(`${subject} '${name}' does not accept arguments`);
    }
    // A bare value binds to the single declared parameter. Two parameters can
    // never be guessed at from one value.
    if (params.length > 1) {
      throw RhinoException.forbidden(`${subject} '${name}' requires named parameters`);
    }
    given = { [params[0]]: raw };
  } else {
    if (params.length === 0) {
      throw RhinoException.forbidden(`${subject} '${name}' does not accept arguments`);
    }
    given = { ...(raw as Record<string, any>) };
  }

  for (const key of Object.keys(given)) {
    // Own-key lookup: `constructor` / `__proto__` must never resolve to a
    // prototype member, whatever query parser fed us.
    if (!params.includes(key)) {
      throw RhinoException.forbidden(`${subject} '${name}' does not accept parameter '${key}'`);
    }
    if (given[key] !== null && typeof given[key] === 'object') {
      throw RhinoException.forbidden(`${subject} '${name}' requires named parameters`);
    }
  }

  const args: Record<string, any> = {};
  for (const param of params) {
    if (Object.prototype.hasOwnProperty.call(given, param)) {
      args[param] = coerceArgument(given[param]);
      continue;
    }
    if (!optional.includes(param)) {
      throw RhinoException.forbidden(`${subject} '${name}' requires parameter '${param}'`);
    }
  }
  return args;
}

/**
 * Query-string values always arrive as strings; hand callables real booleans so
 * a check cannot be fooled by the string "false". Applies to argument VALUES
 * only, never to names.
 */
export function coerceArgument(value: any): any {
  if (typeof value !== 'string') return value;
  const lowered = value.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  return value;
}
