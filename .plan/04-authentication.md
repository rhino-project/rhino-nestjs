# 04 Authentication

**What it does:** JWT-based authentication with login, logout, password recovery, password reset, and invitation registration.

**Laravel equivalent:** `Controllers/AuthController.php`, Sanctum token management.

**NestJS implementation:**

Use `@nestjs/passport` with `passport-jwt` strategy. Auth routes are registered outside tenant route groups (matching Laravel's behavior).

```typescript
@Controller('api/auth')
export class AuthController {
  @Post('login')
  async login(@Body() dto: LoginDto) { ... }
  
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req) { ... }
  
  @Post('recover-password')
  async recoverPassword(@Body() dto: RecoverPasswordDto) { ... }
  
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) { ... }
  
  @Post('register')
  async registerWithInvitation(@Body() dto: RegisterDto) { ... }
}
```

**JWT strategy:**

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: { sub: number }) {
    return this.prisma.user.findUnique({ where: { id: payload.sub } });
  }
}
```

**Login response format** (matching Laravel):

```json
{
  "token": "eyJ...",
  "organization_slug": "acme"
}
```

**Files to create:**
- `/src/controllers/auth.controller.ts`
- `/src/services/auth.service.ts`
- `/src/strategies/jwt.strategy.ts`
- `/src/guards/jwt-auth.guard.ts`
- `/src/dto/login.dto.ts`
- `/src/dto/register.dto.ts`

**Tests:** Login success/failure, logout clears token, password reset flow, registration with invitation token.

**Dependencies:** 01, 02.

---
