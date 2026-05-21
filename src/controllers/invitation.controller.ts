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
import { userHasPermission } from '../utils/permission-matcher';

@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  private assertInvitationPermission(req: any, action: string) {
    if (!userHasPermission(req.user, `invitations.${action}`, req.organization)) {
      const err = new Error('Forbidden') as any;
      err.status = 403;
      throw err;
    }
  }

  @Get()
  async index(@Req() req: any, @Query('status') status?: string) {
    this.assertInvitationPermission(req, 'index');
    if (!req.organization) throw new BadRequestException('Organization context required');
    const items = await this.invitations.list(req.organization.id, status);
    return { data: items };
  }

  @Post()
  async store(@Req() req: any, @Body() body: { email: string; roleId: number }) {
    this.assertInvitationPermission(req, 'store');
    if (!req.organization) throw new BadRequestException('Organization context required');
    if (!body?.email || !body?.roleId) {
      throw new BadRequestException('email and roleId required');
    }
    return this.invitations.create({
      email: body.email,
      roleId: body.roleId,
      organization: req.organization,
      invitedBy: req.user,
    });
  }

  @Post(':id/resend')
  async resend(@Req() req: any, @Param('id') id: string) {
    this.assertInvitationPermission(req, 'resend');
    return this.invitations.resend(parseInt(id, 10));
  }

  @Delete(':id')
  async cancel(@Req() req: any, @Param('id') id: string) {
    this.assertInvitationPermission(req, 'cancel');
    return this.invitations.cancel(parseInt(id, 10));
  }

  @Post('accept')
  async accept(@Body() body: { token: string }, @Req() req: any) {
    if (!body?.token) throw new BadRequestException('token required');
    return this.invitations.accept(body.token, req.user?.id);
  }
}
