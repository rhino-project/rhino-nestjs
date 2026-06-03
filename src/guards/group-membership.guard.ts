import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { RhinoConfigService } from '../rhino.config';
import { MembershipService } from '../services/membership.service';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoRequest } from '../interfaces/rhino-request.interface';

/**
 * Coarse group-access gate (design §6), gated entirely by
 * `auth.enforceGroupMembership`.
 *
 * When the flag is OFF this guard is a pure no-op: it returns `true`
 * immediately and never inspects the request, so behavior is byte-for-byte
 * unchanged. Install it AFTER `JwtAuthGuard` (needs `req.user`) and after
 * `RouteGroupMiddleware` (needs `req.__routeGroup`).
 *
 * When ON:
 *   - `public`/skip-auth requests bypass the check (no auth).
 *   - the user must hold a membership row matching the resolved group (NULL row
 *     = wildcard) and, for tenant groups, the resolved org. No match → 403.
 *   - on success, the matched rows' permissions become the permission source
 *     for the downstream ResourcePolicy (attached as `__membershipPermissions`).
 */
@Injectable()
export class GroupMembershipGuard implements CanActivate {
  constructor(
    private readonly config: RhinoConfigService,
    private readonly membership: MembershipService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.membership.enabled()) return true;

    const req = context.switchToHttp().getRequest<RhinoRequest>();
    if (req.__skipAuth) return true;
    const user = req.user;
    if (!user) return true; // unauthenticated handling is JwtAuthGuard's job

    const routeGroup = req.__routeGroup ?? null;
    // The `public` group never enforces membership (no auth).
    if (routeGroup === 'public') return true;

    const org = req.organization ?? null;
    const isTenant = this.config.isTenantGroup(routeGroup);

    const rows = this.membership.matchingRows(user, routeGroup, org, isTenant);
    if (rows.length === 0) {
      throw RhinoException.membershipDenied();
    }

    // Switch the permission source to the matched membership row(s).
    (user as any).__membershipPermissions = this.membership.permissionsFromRows(rows);
    return true;
  }
}
