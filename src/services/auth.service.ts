import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RhinoException } from '../errors/rhino-exception';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';

export interface LoginResult {
  token: string;
  organizationSlug?: string;
  user: any;
}

export interface TokenPayload {
  sub: number | string;
  email?: string;
  iat?: number;
}

/**
 * Authentication primitives: login, logout, password hashing,
 * token issuance, password recovery flow.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
  ) {}

  private userDelegate() {
    const modelName = this.config.authConfig().userModel;
    return this.prisma.model(modelName);
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  async checkPassword(plain: string, hashed: string): Promise<boolean> {
    if (!hashed) return false;
    return bcrypt.compare(plain, hashed);
  }

  signToken(payload: TokenPayload): string {
    const { jwtSecret, jwtExpiresIn } = this.config.authConfig();
    return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn } as any);
  }

  verifyToken(token: string): TokenPayload {
    const { jwtSecret } = this.config.authConfig();
    try {
      return jwt.verify(token, jwtSecret) as TokenPayload;
    } catch {
      throw RhinoException.unauthorized('Invalid or expired token');
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const auth = this.config.authConfig();
    // Only eager-load the org membership graph when multi-tenancy is configured.
    // Single-tenant / org-less apps have no `userRoles` relation on their User
    // model, so an unconditional include would throw inside Prisma and the
    // `.catch(() => null)` below would surface as "Invalid credentials" — i.e.
    // an org-less app could never log a valid user in. Gating the include on
    // `multiTenantEnabled()` keeps multi-tenant behavior byte-for-byte while
    // letting org-less apps authenticate. (We still degrade gracefully if the
    // include fails for any other reason: retry the plain lookup.)
    const wantsOrg = this.config.multiTenantEnabled();
    let user: any = null;
    if (wantsOrg) {
      user = await this.userDelegate().findFirst({
        where: { [auth.emailField]: email },
        include: { userRoles: { include: { organization: true, role: true } } },
      }).catch(() => null);
    }
    if (!user) {
      user = await this.userDelegate().findFirst({
        where: { [auth.emailField]: email },
      }).catch(() => null);
    }

    if (!user) throw RhinoException.unauthorized('Invalid credentials');
    const hashed = (user as any)[auth.passwordField];
    const ok = await this.checkPassword(password, hashed);
    if (!ok) throw RhinoException.unauthorized('Invalid credentials');

    const token = this.signToken({ sub: (user as any).id, email });
    const organizationSlug = (user as any).userRoles?.[0]?.organization?.slug;
    return { token, organizationSlug, user };
  }

  async logout(_user: any): Promise<void> {
    // JWT stateless; consumer can add blacklist logic via hooks.
  }

  /**
   * Revoke a just-issued token. JWTs are stateless, so "revoking" means
   * recording the token in a denylist (when the consumer provides a
   * `RevokedToken` model) so the JwtAuthGuard can reject it on the next
   * request. Used when a lifecycle hook rejects a login/register: the token is
   * never returned AND — IF a denylist model exists — can no longer be used
   * even if it leaked.
   *
   * Bounded guarantee: the caller (AuthController) ALWAYS drops the token from
   * the response on rejection, so an attacker never receives it. Persisting it
   * to a denylist is the *additional* protection against a leaked token. When
   * no `RevokedToken` model is configured we log a clear WARNING so operators
   * know revoke is advisory-only — pair it with short-TTL JWTs (see README /
   * CLAUDE.md "Group-auth hooks & token revocation").
   */
  async revokeToken(token: string): Promise<void> {
    if (!token) return;
    let delegate: any;
    try {
      delegate = this.prisma.model('revokedToken');
    } catch {
      this.logger.warn(
        'AuthService.revokeToken: no `RevokedToken` model is configured, so token ' +
          'revocation is advisory only — the token is dropped from the response but ' +
          'cannot be denylisted if it has already leaked. Add a `RevokedToken` model ' +
          '(token, createdAt) to your Prisma schema and use short-TTL JWTs.',
      );
      return;
    }
    try {
      await delegate.create({ data: { token, createdAt: new Date() } });
    } catch (err) {
      // The model exists but the write failed — surface it so a misconfigured
      // denylist is not silently a no-op.
      this.logger.warn(
        `AuthService.revokeToken: failed to persist revoked token (${(err as Error).message}).`,
      );
    }
  }

  /** Whether a token has been revoked via {@link revokeToken}. */
  async isTokenRevoked(token: string): Promise<boolean> {
    if (!token) return false;
    let delegate: any;
    try {
      delegate = this.prisma.model('revokedToken');
    } catch {
      // No denylist model — nothing can be revoked, so nothing is revoked.
      return false;
    }
    try {
      const row = await delegate.findFirst({ where: { token } });
      return Boolean(row);
    } catch {
      return false;
    }
  }

  async requestPasswordRecovery(email: string): Promise<{ token: string; user: any } | null> {
    const user = await this.userDelegate().findFirst({ where: { email } }).catch(() => null);
    if (!user) return null;
    const token = randomBytes(32).toString('hex');
    try {
      await this.prisma.model('passwordResetToken').upsert({
        where: { email },
        update: { token, createdAt: new Date() },
        create: { email, token, createdAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `AuthService: could not persist password reset token (${(err as Error).message}). ` +
          'Add a `PasswordResetToken` model to your Prisma schema to enable this feature.',
      );
    }
    return { token, user };
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    let reset: any = null;
    try {
      reset = await this.prisma.model('passwordResetToken').findFirst({
        where: { email, token },
      });
    } catch {
      throw new BadRequestException('Password reset not available');
    }
    if (!reset) throw new BadRequestException('Invalid token');
    const hashed = await this.hashPassword(newPassword);
    await this.userDelegate().update({
      where: { email },
      data: { password: hashed },
    });
    try {
      await this.prisma.model('passwordResetToken').delete({ where: { email } });
    } catch { /* ignore */ }
  }
}
