import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { InvitationService } from '../services/invitation.service';
import { RhinoConfigService } from '../rhino.config';
import { MembershipService } from '../services/membership.service';
import { userHasPermission } from '../utils/permission-matcher';
import { RhinoException } from '../errors/rhino-exception';

@Controller('invitations')
export class InvitationController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly config: RhinoConfigService,
    private readonly membership: MembershipService,
  ) {}

  /**
   * Authorize an invitation action.
   *
   * - Enforcement OFF (legacy): byte-for-byte the original check —
   *   `userHasPermission(user, invitations.{action}, org)`; 403 on failure.
   * - Enforcement ON: a COARSE membership gate runs FIRST — the inviter must be
   *   a member of the target group (design §8 — "inviter must be a member of the
   *   group"). A non-member is a **403** for parity with Laravel/Rails
   *   (Decision 9.C), NOT a 400. A NULL/absent membership row is a wildcard and
   *   admits the inviter. The fine-grained permission check then runs (also 403
   *   on failure), resolving via the established heuristic (tenant groups → the
   *   org's user_roles permissions, non-tenant groups → top-level
   *   user.permissions). The two checks run in sequence and are never merged.
   */
  private assertCanInvite(
    req: any,
    routeGroup: string | null | undefined,
    action: string,
  ) {
    if (this.membership.enabled()) {
      const isTenant = this.config.isTenantGroup(routeGroup ?? undefined);
      if (!this.membership.isMember(req.user, routeGroup ?? null, req.organization, isTenant)) {
        throw RhinoException.membershipDenied(
          `Inviter is not a member of group '${routeGroup ?? '(any)'}'`,
        );
      }
    }

    if (!userHasPermission(req.user, `invitations.${action}`, req.organization)) {
      throw RhinoException.forbidden();
    }
  }

  /** The `public` group (reserved name or any `skipAuth` group) has no auth, so it cannot be invited into. */
  private isPublicGroup(routeGroup: string | null | undefined): boolean {
    if (routeGroup == null) return false;
    if (routeGroup === 'public') return true;
    return this.config.routeGroups()?.[routeGroup]?.skipAuth === true;
  }

  /**
   * Reject a `routeGroup` that is neither a configured route group nor the
   * reserved `public` name. A client could otherwise forge an arbitrary group
   * value (overriding the resolved group) and create a dormant, unaudited grant
   * that activates the day that group name is wired up. This guard runs
   * regardless of enforcement. NULL (wildcard) is always allowed.
   */
  private assertKnownGroup(routeGroup: string | null | undefined): void {
    if (routeGroup == null) return; // NULL wildcard
    if (routeGroup === 'public') return; // reserved; rejected later by isPublicGroup
    if (this.config.routeGroups()?.[routeGroup]) return; // a configured group
    throw RhinoException.validationFailed({
      routeGroup: [`Unknown route group '${routeGroup}'`],
    });
  }

  @Get()
  async index(@Req() req: any, @Query('status') status?: string) {
    this.assertCanInvite(req, (req.__routeGroup as string | undefined) ?? null, 'index');
    if (!req.organization) throw new BadRequestException('Organization context required');
    const items = await this.invitations.list(req.organization.id, status);
    return { data: items };
  }

  @Post()
  async store(
    @Req() req: any,
    @Body() body: { email: string; roleId: number; routeGroup?: string | null },
  ) {
    if (!body?.email || !body?.roleId) {
      throw new BadRequestException('email and roleId required');
    }
    // The invite's group: an explicit body value, else the request's resolved
    // group (set by RouteGroupMiddleware), else NULL (wildcard).
    const routeGroup =
      body.routeGroup !== undefined
        ? body.routeGroup
        : (req.__routeGroup as string | undefined) ?? null;
    // Reject a forged/unknown route group (422) before any other processing so
    // a client can never seed a dormant grant for an unconfigured group.
    this.assertKnownGroup(routeGroup);
    // The public group has no auth and cannot be invited into.
    if (this.isPublicGroup(routeGroup)) {
      throw new BadRequestException('Cannot invite into the public group');
    }
    // Tenant-group invites still require an org context; non-tenant invites
    // (an explicit NULL/non-tenant group) may proceed without one. This is
    // checked BEFORE authorization so the legacy "org required" 400 is returned
    // for org-less tenant invites rather than a permission 403.
    if (this.isTenantInvite(routeGroup) && !req.organization) {
      throw new BadRequestException('Organization context required');
    }
    this.assertCanInvite(req, routeGroup, 'store');
    return this.invitations.create({
      email: body.email,
      roleId: body.roleId,
      organization: req.organization,
      invitedBy: req.user,
      routeGroup,
    });
  }

  /**
   * Whether this invite requires an organization context. We default to YES to
   * preserve legacy behavior (store always required an org). An invite is only
   * treated as non-tenant — and thus org-optional — when membership enforcement
   * is on AND the resolved group is positively a non-tenant group. This keeps
   * every flag-off code path byte-for-byte unchanged.
   */
  private isTenantInvite(routeGroup: string | null | undefined): boolean {
    if (!this.config.enforceGroupMembership()) return true;
    if (routeGroup == null) return true;
    return this.config.isTenantGroup(routeGroup);
  }

  @Post(':id/resend')
  async resend(@Req() req: any, @Param('id') id: string) {
    this.assertCanInvite(req, (req.__routeGroup as string | undefined) ?? null, 'resend');
    return this.invitations.resend(parseInt(id, 10));
  }

  @Delete(':id')
  async cancel(@Req() req: any, @Param('id') id: string) {
    this.assertCanInvite(req, (req.__routeGroup as string | undefined) ?? null, 'cancel');
    return this.invitations.cancel(parseInt(id, 10));
  }

  @Post('accept')
  async accept(@Body() body: { token: string }, @Req() req: any) {
    if (!body?.token) throw new BadRequestException('token required');
    return this.invitations.accept(body.token, req.user?.id);
  }
}
