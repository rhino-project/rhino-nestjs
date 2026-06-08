import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoRequest } from '../interfaces/rhino-request.interface';

/**
 * Simple JWT guard that verifies the Bearer token, loads the user
 * (with userRoles for permission checks), and attaches to `request.user`.
 * If the route is in a public group, it is typically skipped at the registration layer.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RhinoRequest>();
    if (req.__skipAuth) return true;
    const header = String(req.headers?.authorization ?? '');
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw RhinoException.unauthorized('Missing bearer token');
    }
    const payload = this.auth.verifyToken(token);
    if (await this.auth.isTokenRevoked(token)) {
      throw RhinoException.unauthorized('Token has been revoked');
    }
    const userModel = this.config.authConfig().userModel;
    const delegate = this.prisma.model(userModel);
    // Only eager-load userRoles when multi-tenancy is configured. A
    // single-tenant / org-less app's User model has no `userRoles` relation, so
    // an unconditional include throws inside Prisma — which would make every
    // authenticated request fail with a 401 even though the token is valid.
    // Gate the include and fall back to a plain lookup if it fails. Multi-tenant
    // behavior is byte-for-byte unchanged.
    let user: any = null;
    if (this.config.multiTenantEnabled()) {
      // Preferred: also eager-load the org role layer (org_role_permissions) so
      // layered permission resolution has the role-level grants. Apps that have
      // not added the OrgRolePermission relation will throw on this include —
      // fall back to the role-only include (grant/deny columns are scalars and
      // still load there), then to a plain lookup. Existing behavior is unchanged.
      user = await delegate
        .findUnique({
          where: { id: payload.sub },
          include: {
            userRoles: { include: { role: { include: { orgRolePermissions: true } } } },
          },
        })
        .catch(() => null);
      if (!user) {
        user = await delegate
          .findUnique({
            where: { id: payload.sub },
            include: { userRoles: { include: { role: true } } },
          })
          .catch(() => null);
      }
    }
    if (!user) {
      user = await delegate
        .findUnique({ where: { id: payload.sub } })
        .catch(() => null);
    }
    if (!user) throw RhinoException.unauthorized('User not found');
    req.user = user;
    return true;
  }
}
