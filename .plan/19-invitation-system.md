# 19 Invitation System

**What it does:** Token-based user invitations with role assignment. Admins invite users to organizations, users register via invitation token.

**Laravel equivalent:** `Controllers/InvitationController.php`, `Models/OrganizationInvitation.php`.

**NestJS implementation:**

```typescript
@Controller('api/:organization/invitations')
export class InvitationController {
  @Get()
  async index() { ... }    // List invitations for org
  
  @Post()
  async store() { ... }    // Create invitation, send email
  
  @Post(':id/resend')
  async resend() { ... }   // Resend invitation email
  
  @Delete(':id')
  async cancel() { ... }   // Cancel pending invitation
}
```

Invitation model in Prisma:

```prisma
model OrganizationInvitation {
  id             Int       @id @default(autoincrement())
  organizationId Int
  email          String
  roleId         Int
  token          String    @unique @db.Char(64)
  status         String    @default("pending")
  invitedById    Int
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())
}
```

**Files to create:**
- `/src/controllers/invitation.controller.ts`
- `/src/services/invitation.service.ts`

**Dependencies:** 04, 08.

---
