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
    const user = await this.userDelegate().findFirst({
      where: { [auth.emailField]: email },
      include: { userRoles: { include: { organization: true, role: true } } },
    }).catch(() => null);

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

  async requestPasswordRecovery(email: string): Promise<{ token: string } | null> {
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
    return { token };
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
