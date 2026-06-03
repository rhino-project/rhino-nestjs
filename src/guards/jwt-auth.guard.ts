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
    const user = await delegate.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw RhinoException.unauthorized('User not found');
    req.user = user;
    return true;
  }
}
