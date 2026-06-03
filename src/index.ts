// Module
export { RhinoModule, type RhinoModuleOptions } from './rhino.module';

// Errors
export {
  RhinoException,
  RhinoAuthRejected,
  type RhinoErrorCode,
  type RhinoErrorBody,
} from './errors/rhino-exception';

// Typed request
export type { RhinoRequest } from './interfaces/rhino-request.interface';
export {
  RhinoConfigService,
  normalizeConfig,
} from './rhino.config';

// Constants
export {
  RHINO_CONFIG,
  RHINO_PRISMA_CLIENT,
  RHINO_MODULE_OPTIONS,
} from './constants/tokens';

// Interfaces
export * from './interfaces/rhino-config.interface';

// Policies
export { ResourcePolicy } from './policies/resource-policy';

// Guards
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { ResourcePolicyGuard } from './guards/resource-policy.guard';
export { GroupMembershipGuard } from './guards/group-membership.guard';

// Interceptors
export { ResponseInterceptor, paginated } from './interceptors/response.interceptor';
export { HiddenColumnsInterceptor } from './interceptors/hidden-columns.interceptor';

// Middleware
export { ResolveOrganizationMiddleware } from './middleware/resolve-organization.middleware';
export { RouteGroupMiddleware } from './middleware/route-group.middleware';
export {
  createTenantRouteRewrite,
  type TenantRouteRewriteOptions,
} from './middleware/tenant-route-rewrite';
export {
  createDomainRouteResolver,
  type DomainRouteResolverOptions,
} from './middleware/domain-route-resolver';

// Controllers (consuming apps can re-export under their own routes)
export { GlobalController } from './controllers/global.controller';
export { AuthController } from './controllers/auth.controller';
export { InvitationController } from './controllers/invitation.controller';
export { NestedController } from './controllers/nested.controller';

// Services
export { PrismaService, type PrismaClientLike } from './prisma/prisma.service';
export { ResourceService } from './services/resource.service';
export { QueryBuilderService } from './services/query-builder.service';
export { SerializerService, BASE_HIDDEN_COLUMNS } from './services/serializer.service';
export { ValidationService } from './services/validation.service';
export { AuditService } from './services/audit.service';
export { AuthService } from './services/auth.service';
export { InvitationService } from './services/invitation.service';
export { AuthHooksService, type AuthHookEvent } from './services/auth-hooks.service';
export {
  MembershipService,
  type MembershipRow,
} from './services/membership.service';
export { NestedService } from './services/nested.service';
export { OrganizationService } from './services/organization.service';
export { ScopeService, type RhinoScope } from './services/scope.service';
export { applyRhinoRouting, describeRoutes } from './services/route-registration.service';

// Prisma extensions
export { withSoftDelete } from './prisma/prisma-soft-delete.extension';
export { withUuid } from './prisma/prisma-uuid.extension';

// Decorators
export {
  RhinoModel,
  getRhinoModelMetadata,
  BelongsToOrganization,
  HasAuditTrail,
  HasUuid,
  HasSoftDeletes,
  ExceptActions,
  HidableColumns,
  PermittedAttrs,
} from './decorators';

// Utils
export {
  coercePermissions,
  matchesPermission,
  resolveUserRoleSlug,
  resolveUserPermissions,
  userHasPermission,
} from './utils/permission-matcher';
export { formatPrice, type CurrencyCode } from './utils/format';
export {
  compileDomain,
  matchDomain,
  type CompiledDomain,
  type DomainMatch,
} from './utils/domain-pattern';
export {
  validateRouteGroups,
  RouteGroupConflictError,
} from './utils/route-group-validator';
export { autoDiscoverScopes, type ScopeDiscoveryOptions } from './utils/scope-discovery';
export { defineModel, type ModelDefinition } from './utils/model-builder';
export {
  findOrganizationFkChain,
  type FkRelation,
  type FkChainStep,
  type WalkOptions,
} from './utils/fk-chain-walker';

// Exporters
export {
  generatePostmanCollection,
  type PostmanExporterOptions,
} from './exporters/postman-exporter';
export {
  generateTypeScriptTypes,
  type TypeScriptExporterOptions,
} from './exporters/typescript-exporter';

// CLI utilities (re-exported for programmatic use)
export { parseFlags, extractCommand, printHelp } from './cli/index';
export { runInstall } from './cli/commands/install.command';
export { runGenerate } from './cli/commands/generate.command';
export { runBlueprint } from './cli/commands/blueprint.command';
export { runExportPostman } from './cli/commands/export-postman.command';
export { runExportTypes } from './cli/commands/export-types.command';
export {
  ask,
  confirm,
  selectFromList,
  createInterface as createReadlineInterface,
} from './cli/utils/prompt';
export {
  fileExists,
  writeFileSafely,
  appendIfMissing,
} from './cli/utils/io';

// Blueprint system
export { BlueprintParser } from './blueprint/blueprint-parser';
export type { Blueprint, BlueprintColumn, BlueprintOptions, BlueprintPermission, BlueprintRelationship } from './blueprint/blueprint-parser';
export { BlueprintValidator } from './blueprint/blueprint-validator';
export type { ValidationResult } from './blueprint/blueprint-validator';
export { ManifestManager } from './blueprint/manifest-manager';
export { BlueprintRunner } from './blueprint/blueprint-runner';
export type { RunnerOptions, RunnerResult } from './blueprint/blueprint-runner';
export { PrismaSchemaGenerator } from './blueprint/generators/prisma-schema-generator';
export { ResourceDefinitionGenerator } from './blueprint/generators/resource-definition-generator';
export { PolicyGenerator } from './blueprint/generators/policy-generator';
export { TestGenerator } from './blueprint/generators/test-generator';
export { SeederGenerator } from './blueprint/generators/seeder-generator';
