/**
 * How many client-selectable named scopes one request may combine when the app
 * sets no `maxScopesPerRequest`.
 *
 * Lives here rather than next to the query builder on purpose: `RhinoConfigService`
 * needs it, and importing it from the query builder would make `rhino.config.ts`
 * and `query-builder.service.ts` import each other. That cycle leaves
 * `RhinoConfigService` undefined while the query builder's decorators run, so
 * Nest sees no constructor type and injects nothing — the service silently loses
 * its config.
 */
export const DEFAULT_MAX_SCOPES_PER_REQUEST = 3;
