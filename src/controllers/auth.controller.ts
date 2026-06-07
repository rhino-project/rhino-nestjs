import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { InvitationService } from '../services/invitation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { AuthHooksService, type AuthHookEvent } from '../services/auth-hooks.service';
import { MembershipService } from '../services/membership.service';
import { RhinoException } from '../errors/rhino-exception';
import type { AuthHookContext } from '../interfaces/rhino-config.interface';

export interface LoginDto {
  email: string;
  password: string;
}
export interface RecoverDto {
  email: string;
}
export interface ResetDto {
  email: string;
  token: string;
  password: string;
}
export interface RegisterDto {
  email: string;
  password: string;
  name?: string;
  invitationToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly invitationService: InvitationService,
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
    // Optional so lightweight unit harnesses can omit it (no-op hooks then).
    private readonly hooks?: AuthHooksService,
    // Optional for the same reason: when absent, membership enforcement is a
    // no-op (equivalent to `auth.enforceGroupMembership` being off).
    private readonly membership?: MembershipService,
  ) {}

  /** Group resolved for this auth request (set by RouteGroupMiddleware). */
  private routeGroup(req: any): string | null {
    return (req?.__routeGroup as string | undefined) ?? null;
  }

  /**
   * Run a lifecycle hook for the resolved group. `revokes` flags token-issuing
   * actions: when the hook rejects, the issued token is dropped (revoked) and
   * the rejection's status is re-thrown. When no hooks service is wired, this
   * is a no-op.
   */
  private async runHook(
    event: AuthHookEvent,
    req: any,
    ctx: AuthHookContext,
  ): Promise<void> {
    if (!this.hooks) return;
    await this.hooks.run(event, this.routeGroup(req), ctx);
  }

  /**
   * Enforce group membership at the auth boundary — parity with the
   * GroupMembershipGuard (resource layer) and the Laravel/Rails AuthControllers.
   *
   * When `auth.enforceGroupMembership` is ON, a non-member must be rejected at
   * `/auth/login` with **403** rather than being allowed to authenticate and
   * only blocked later on the first resource request. The just-issued token is
   * revoked (best-effort) and never returned. This is the COARSE gate, so it
   * runs BEFORE the `afterLogin` hook.
   *
   * No-op when: enforcement is off (or the MembershipService isn't wired), the
   * request skips auth, or the resolved group is `public`.
   */
  private async assertGroupMembership(
    req: any,
    user: any,
    token: string,
  ): Promise<void> {
    if (!this.membership?.enabled()) return;
    // NOTE: we deliberately do NOT bail on `req.__skipAuth` here. Consumers set
    // that flag on auth entrypoints (login/register) to bypass the JWT guard
    // (there's no token yet) — it does NOT mean "skip membership". The genuine
    // skip signal is the `public` group, handled below (matches the guard).
    const routeGroup = this.routeGroup(req);
    if (routeGroup === 'public') return;
    const org = req?.organization ?? null;
    const isTenant = this.config.isTenantGroup(routeGroup);
    if (this.membership.isMember(user, routeGroup, org, isTenant)) return;
    await this.authService.revokeToken(token);
    throw RhinoException.membershipDenied();
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req?: any) {
    if (!dto?.email || !dto?.password) {
      throw new BadRequestException('Email and password required');
    }
    const { token, organizationSlug, user } = await this.authService.login(
      dto.email,
      dto.password,
    );
    // Coarse membership gate (before the hook): a non-member is rejected here
    // with 403, matching the resource-layer guard and the Laravel/Rails stacks.
    await this.assertGroupMembership(req, user, token);
    const routeGroup = this.routeGroup(req);
    try {
      await this.runHook('afterLogin', req, {
        user,
        routeGroup,
        token,
        request: req,
      });
    } catch (err) {
      // Reject → revoke the just-issued token (never returned to the client).
      await this.authService.revokeToken(token);
      throw err;
    }
    return { token, organization_slug: organizationSlug };
  }

  @Post('logout')
  async logout(@Req() req: any) {
    await this.authService.logout(req.user);
    await this.runHook('afterLogout', req, {
      user: req.user,
      routeGroup: this.routeGroup(req),
      request: req,
    });
    return { success: true };
  }

  @Post('password/recover')
  async recover(@Body() dto: RecoverDto, @Req() req?: any) {
    if (!dto?.email) throw new BadRequestException('Email required');
    const result = await this.authService.requestPasswordRecovery(dto.email);
    // FIX 6: password recovery MUST return a uniform response whether or not the
    // email exists (no user-enumeration oracle). The hook runs for side effects
    // only — a rejection is swallowed so it can never change the response and
    // thereby reveal account existence. (Other actions keep reject semantics.)
    try {
      await this.runHook('afterPasswordRecover', req, {
        user: (result as any)?.user ?? null,
        routeGroup: this.routeGroup(req),
        request: req,
      });
    } catch {
      /* swallow: recovery response is always uniform */
    }
    return { success: true };
  }

  @Post('password/reset')
  async reset(@Body() dto: ResetDto, @Req() req?: any) {
    if (!dto?.email || !dto?.token || !dto?.password) {
      throw new BadRequestException('Email, token and password required');
    }
    await this.authService.resetPassword(dto.email, dto.token, dto.password);
    await this.runHook('afterPasswordReset', req, {
      user: null,
      routeGroup: this.routeGroup(req),
      request: req,
    });
    return { success: true };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req?: any) {
    if (!dto?.email || !dto?.password || !dto?.invitationToken) {
      throw new BadRequestException('Email, password and invitationToken required');
    }
    const auth = this.config.authConfig();
    const hashed = await this.authService.hashPassword(dto.password);
    const user = await this.prisma.model(auth.userModel).create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name ?? '',
      },
    });
    const acceptance = await this.invitationService.accept(
      dto.invitationToken,
      (user as any).id,
    );
    const token = this.authService.signToken({ sub: (user as any).id, email: dto.email });
    // Hooks see the group the membership was created for, falling back to the
    // request's resolved group.
    const routeGroup =
      (acceptance as any)?.routeGroup ?? this.routeGroup(req);
    try {
      await this.runHook('afterRegister', req, {
        user,
        routeGroup,
        organization: (acceptance as any)?.organization ?? null,
        token,
        request: req,
      });
    } catch (err) {
      await this.authService.revokeToken(token);
      throw err;
    }
    return {
      token,
      user,
      ...acceptance,
    };
  }
}
