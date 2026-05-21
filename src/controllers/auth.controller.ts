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
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    if (!dto?.email || !dto?.password) {
      throw new BadRequestException('Email and password required');
    }
    const { token, organizationSlug } = await this.authService.login(dto.email, dto.password);
    return { token, organization_slug: organizationSlug };
  }

  @Post('logout')
  async logout(@Req() req: any) {
    await this.authService.logout(req.user);
    return { success: true };
  }

  @Post('password/recover')
  async recover(@Body() dto: RecoverDto) {
    if (!dto?.email) throw new BadRequestException('Email required');
    await this.authService.requestPasswordRecovery(dto.email);
    return { success: true };
  }

  @Post('password/reset')
  async reset(@Body() dto: ResetDto) {
    if (!dto?.email || !dto?.token || !dto?.password) {
      throw new BadRequestException('Email, token and password required');
    }
    await this.authService.resetPassword(dto.email, dto.token, dto.password);
    return { success: true };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
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
    const acceptance = await this.invitationService.accept(dto.invitationToken, (user as any).id);
    const token = this.authService.signToken({ sub: (user as any).id, email: dto.email });
    return {
      token,
      user,
      ...acceptance,
    };
  }
}
