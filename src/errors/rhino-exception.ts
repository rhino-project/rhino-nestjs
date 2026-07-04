import { HttpException } from '@nestjs/common';

export type RhinoErrorCode =
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN_FIELDS'
  | 'CROSS_TENANT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ACTION_DISABLED'
  | 'UNKNOWN_RESOURCE'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_USED'
  | 'INVITATION_INVALID_ROLE'
  | 'NESTED_OPERATION_FAILED'
  | 'INCLUDE_NOT_AUTHORIZED'
  | 'AUTH_REJECTED'
  | 'MEMBERSHIP_DENIED'
  | 'TENANT_CONTEXT_REQUIRED';

export interface RhinoErrorBody {
  code: RhinoErrorCode;
  message: string;
  details?: Record<string, any>;
}

/**
 * Single exception shape surfaced by the library. Frontends can rely on the
 * `{ code, message, details }` envelope regardless of HTTP status.
 */
export class RhinoException extends HttpException {
  readonly code: RhinoErrorCode;

  constructor(code: RhinoErrorCode, message: string, status: number, details?: Record<string, any>) {
    const body: RhinoErrorBody = { code, message, ...(details ? { details } : {}) };
    super(body, status);
    this.code = code;
  }

  static validationFailed(errors: Record<string, string[]>): RhinoException {
    return new RhinoException('VALIDATION_FAILED', 'Validation failed', 422, { errors });
  }

  static forbiddenFields(fields: string[]): RhinoException {
    return new RhinoException('FORBIDDEN_FIELDS', 'Request contains fields not allowed for your role', 403, {
      fields,
    });
  }

  static crossTenant(errors: Record<string, string[]>): RhinoException {
    return new RhinoException('CROSS_TENANT', 'Referenced record not in current organization', 422, { errors });
  }

  static unauthorized(message = 'Unauthorized'): RhinoException {
    return new RhinoException('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'This action is unauthorized.'): RhinoException {
    return new RhinoException('FORBIDDEN', message, 403);
  }

  static notFound(message = 'Not found'): RhinoException {
    return new RhinoException('NOT_FOUND', message, 404);
  }

  static actionDisabled(action: string): RhinoException {
    return new RhinoException('ACTION_DISABLED', 'Action not available', 404, { action });
  }

  static unknownResource(slug: string): RhinoException {
    return new RhinoException('UNKNOWN_RESOURCE', `Unknown resource: ${slug}`, 404, { slug });
  }

  static includeNotAuthorized(slug: string): RhinoException {
    return new RhinoException('INCLUDE_NOT_AUTHORIZED', `Include not authorized: ${slug}`, 403, { slug });
  }

  static authRejected(message = 'Authentication rejected', status = 403): RhinoException {
    return new RhinoException('AUTH_REJECTED', message, status);
  }

  static membershipDenied(message = 'You are not a member of this group.'): RhinoException {
    return new RhinoException('MEMBERSHIP_DENIED', message, 403);
  }

  /**
   * Fail-closed guard for the resource-scope resolver: a model that
   * `belongsToOrganization` was queried without an organization context.
   */
  static tenantContextRequired(
    message = 'An organization context is required for this resource.',
  ): RhinoException {
    return new RhinoException('TENANT_CONTEXT_REQUIRED', message, 403);
  }
}

/**
 * Thrown by a lifecycle hook to reject an otherwise-successful auth action.
 * The controller catches it: for token-issuing actions (login/register) the
 * just-issued token is revoked; the configured `status` (default 403) is then
 * returned to the client. A hook may also throw any other error.
 */
export class RhinoAuthRejected extends RhinoException {
  constructor(message = 'Authentication rejected', status = 403) {
    super('AUTH_REJECTED', message, status);
  }
}
