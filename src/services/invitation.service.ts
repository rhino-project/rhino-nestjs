import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { RhinoException } from '../errors/rhino-exception';

export interface CreateInvitationInput {
  email: string;
  roleId: number;
  organization: any;
  invitedBy: any;
  /** The group the invitee will join (design §8). NULL = wildcard membership. */
  routeGroup?: string | null;
}

/**
 * Invitation lifecycle: create/resend/cancel/accept with token-based acceptance.
 * Mirrors Laravel's InvitationController + OrganizationInvitation model.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
  ) {}

  private delegate() {
    return this.prisma.model('organizationInvitation');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex'); // 64 hex chars
  }

  /** Whether the inviter holds a membership row for `routeGroup` (wildcard ok). */
  private inviterIsMember(inviter: any, routeGroup: string, org: any): boolean {
    const rows = inviter?.userRoles ?? inviter?.user_roles ?? [];
    const orgId = org?.id ?? null;
    for (const ur of rows) {
      const rg = ur.routeGroup ?? ur.route_group ?? null;
      if (rg !== null && String(rg) !== routeGroup) continue;
      const rowOrg = ur.organizationId ?? ur.organization_id ?? null;
      if (orgId != null && rowOrg != null && rowOrg !== orgId) continue;
      return true;
    }
    return false;
  }

  private expiresAt(): Date {
    const days = this.config.invitationsConfig().expiresDays;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  async list(organizationId: number, status?: string) {
    const where: any = { organizationId };
    if (status && status !== 'all') where.status = status;
    return this.delegate().findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async create(input: CreateInvitationInput) {
    const cfg = this.config.invitationsConfig();
    if (cfg.allowedRoles) {
      const role = await this.prisma.model('role').findUnique({ where: { id: input.roleId } });
      if (!role || !cfg.allowedRoles.includes((role as any).slug)) {
        throw new BadRequestException('Role not allowed for invitations');
      }
    }
    const routeGroup = input.routeGroup ?? null;
    // The `public` group has no auth, so it cannot be invited into (design §8).
    if (routeGroup === 'public') {
      throw new BadRequestException('Cannot invite into the public group');
    }
    // When enforcement is on, the inviter must themselves be a member of the
    // group they are inviting into (design §8). NULL (wildcard) skips this — a
    // wildcard inviter can invite into any group.
    if (this.config.enforceGroupMembership() && routeGroup != null) {
      if (!this.inviterIsMember(input.invitedBy, routeGroup, input.organization)) {
        // Coarse membership denial → 403 for parity with Laravel/Rails
        // (Decision 9.C), matching the controller's gate.
        throw RhinoException.membershipDenied('You are not a member of that group');
      }
    }
    // Tenant groups carry an org; non-tenant groups store a NULL org. Default
    // to using the org (legacy behavior) — only drop it when enforcement is on
    // AND the group is positively non-tenant, keeping flag-off paths unchanged.
    const dropOrg =
      this.config.enforceGroupMembership() &&
      routeGroup != null &&
      !this.config.isTenantGroup(routeGroup);
    const organizationId = dropOrg ? null : input.organization?.id ?? null;
    const token = this.generateToken();
    const invitation = await this.delegate().create({
      data: {
        organizationId,
        email: input.email,
        roleId: input.roleId,
        routeGroup,
        token,
        status: 'pending',
        invitedById: input.invitedBy.id,
        expiresAt: this.expiresAt(),
      },
    });
    if (cfg.notificationHandler) {
      await cfg.notificationHandler(invitation);
    }
    return invitation;
  }

  async resend(id: number) {
    const invitation = await this.delegate().findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if ((invitation as any).status !== 'pending') {
      throw new BadRequestException('Only pending invitations can be resent');
    }
    const refreshed = await this.delegate().update({
      where: { id },
      data: { token: this.generateToken(), expiresAt: this.expiresAt() },
    });
    const cfg = this.config.invitationsConfig();
    if (cfg.notificationHandler) await cfg.notificationHandler(refreshed);
    return refreshed;
  }

  async cancel(id: number) {
    const invitation = await this.delegate().findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if ((invitation as any).status !== 'pending') {
      throw new BadRequestException('Only pending invitations can be cancelled');
    }
    return this.delegate().update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async accept(token: string, userId?: number) {
    const invitation = await this.delegate().findUnique({
      where: { token },
      include: { organization: true, role: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    const inv: any = invitation;
    if (inv.status !== 'pending') throw new BadRequestException('Invitation no longer valid');
    if (inv.expiresAt < new Date()) {
      await this.delegate().update({ where: { id: inv.id }, data: { status: 'expired' } });
      throw new BadRequestException('Invitation expired');
    }

    const routeGroup = inv.routeGroup ?? inv.route_group ?? null;

    if (!userId) {
      // User is unauthenticated — return org/role so client can register
      return {
        requiresRegistration: true,
        organization: inv.organization,
        role: inv.role,
        email: inv.email,
        routeGroup,
      };
    }

    await this.prisma.model('userRole').create({
      data: {
        userId,
        organizationId: inv.organizationId ?? null,
        roleId: inv.roleId,
        routeGroup,
        permissions: [],
      },
    });
    await this.delegate().update({
      where: { id: inv.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    return { accepted: true, organization: inv.organization, routeGroup };
  }
}
