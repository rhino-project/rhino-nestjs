import type { Request } from 'express';

/**
 * Typed shape of the Express request after Rhino middleware has run.
 * Internal keys are prefixed `__` to avoid collisions with app data.
 */
export interface RhinoRequest<TUser = any, TOrg = any> extends Request {
  user?: TUser;
  organization?: TOrg;
  __routeGroup?: string;
  __skipAuth?: boolean;
  __action?: string;
}
