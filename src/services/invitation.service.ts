import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';

export interface CreateInvitationInput {
  email: string;
  roleId: number;
  organization: any;
  invitedBy: any;
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
    const token = this.generateToken();
    const invitation = await this.delegate().create({
      data: {
        organizationId: input.organization.id,
        email: input.email,
        roleId: input.roleId,
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

    if (!userId) {
      // User is unauthenticated — return org/role so client can register
      return {
        requiresRegistration: true,
        organization: inv.organization,
        role: inv.role,
        email: inv.email,
      };
    }

    await this.prisma.model('userRole').create({
      data: {
        userId,
        organizationId: inv.organizationId,
        roleId: inv.roleId,
        permissions: [],
      },
    });
    await this.delegate().update({
      where: { id: inv.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    return { accepted: true, organization: inv.organization };
  }
}
