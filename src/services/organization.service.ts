import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';

/**
 * Resolves a route's `organization` parameter to a concrete organization record.
 * Mirrors Laravel's `ResolveOrganizationFromRoute` middleware.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
  ) {}

  async resolve(identifier: string | number, user?: any): Promise<any> {
    const column = this.config.organizationIdentifierColumn();
    const modelName = this.config.raw().multiTenant?.organizationModel ?? 'organization';
    const value =
      column === 'id' || /^\d+$/.test(String(identifier))
        ? column === 'id'
          ? Number(identifier)
          : identifier
        : identifier;

    const delegate = this.prisma.model(modelName);
    const org = await delegate.findFirst({ where: { [column]: value } });
    if (!org) throw new NotFoundException('Organization not found');

    if (user) {
      await this.ensureMembership(user, org);
    }

    return org;
  }

  async ensureMembership(user: any, org: any): Promise<void> {
    const userOrgModel = this.config.raw().multiTenant?.userOrganizationModel ?? 'userRole';
    const delegate = this.prisma.model(userOrgModel);
    const membership = await delegate.findFirst({
      where: { userId: user.id, organizationId: org.id },
    });
    if (!membership) throw new NotFoundException('Organization not found');
  }
}
