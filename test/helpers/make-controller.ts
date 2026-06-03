import { createMockPrisma } from './mock-prisma';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RhinoConfigService, normalizeConfig } from '../../src/rhino.config';
import { ResourceService } from '../../src/services/resource.service';
import { QueryBuilderService } from '../../src/services/query-builder.service';
import { ScopeService } from '../../src/services/scope.service';
import { SerializerService } from '../../src/services/serializer.service';
import { ValidationService } from '../../src/services/validation.service';
import { AuditService } from '../../src/services/audit.service';
import { GlobalController } from '../../src/controllers/global.controller';
import { NestedService } from '../../src/services/nested.service';
import { NestedController } from '../../src/controllers/nested.controller';
import { InvitationService } from '../../src/services/invitation.service';
import { InvitationController } from '../../src/controllers/invitation.controller';
import { AuthService } from '../../src/services/auth.service';
import { AuthController } from '../../src/controllers/auth.controller';
import { AuthHooksService } from '../../src/services/auth-hooks.service';
import { MembershipService } from '../../src/services/membership.service';
import type { RhinoConfig } from '../../src/interfaces/rhino-config.interface';

export function buildEnv(cfg: RhinoConfig, initialData: Record<string, any[]> = {}) {
  const client = createMockPrisma(initialData);
  const prisma = new PrismaService(client);
  const config = new RhinoConfigService(normalizeConfig(cfg));
  const queryBuilder = new QueryBuilderService();
  const scopes = new ScopeService();
  const resources = new ResourceService(prisma, config, queryBuilder, scopes);
  const serializer = new SerializerService();
  const validator = new ValidationService(prisma, config);
  const audit = new AuditService(prisma);
  const nested = new NestedService(prisma, config, validator);
  const invitation = new InvitationService(prisma, config);
  const auth = new AuthService(prisma, config);
  const hooks = new AuthHooksService(config);
  const membership = new MembershipService(config);

  const global = new GlobalController(config, resources, serializer, validator, audit);
  const nestedCtrl = new NestedController(nested, config);
  const invitationCtrl = new InvitationController(invitation, config, membership);
  const authCtrl = new AuthController(auth, invitation, prisma, config, hooks);

  return {
    client,
    prisma,
    config,
    resources,
    serializer,
    validator,
    audit,
    auth,
    invitation,
    nested,
    hooks,
    membership,
    controllers: { global, nested: nestedCtrl, invitation: invitationCtrl, auth: authCtrl },
  };
}
