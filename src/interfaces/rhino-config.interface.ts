import type { Type } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { ResourcePolicy } from '../policies/resource-policy';
import type { PrismaClientLike } from '../prisma/prisma.service';

export interface ModelRegistration {
  /** Prisma model name (camelCase or PascalCase — matches the delegate on prisma client) */
  model: string;
  policy?: Type<ResourcePolicy>;
  validation?: ZodSchema;
  validationStore?: ZodSchema | Record<string, ZodSchema>;
  validationUpdate?: ZodSchema | Record<string, ZodSchema>;
  allowedFilters?: string[];
  allowedSorts?: string[];
  defaultSort?: string;
  allowedFields?: string[];
  allowedIncludes?: string[];
  allowedSearch?: string[];
  exceptActions?: string[];
  paginationEnabled?: boolean;
  perPage?: number;
  softDeletes?: boolean;
  middleware?: Type<NestMiddleware>[];
  actionMiddleware?: Record<string, Type<NestMiddleware>[]>;
  owner?: string;
  belongsToOrganization?: boolean;
  hasAuditTrail?: boolean;
  hasUuid?: boolean;
  additionalHiddenColumns?: string[];
  auditExclude?: string[];
  computedAttributes?: (record: any, user: any) => Record<string, any>;
  scopes?: Type<any>[];
  /** Foreign-key constraints to verify against the current organization. */
  fkConstraints?: Array<{ field: string; model: string }>;
}

export interface RouteGroupConfig {
  prefix?: string;
  middleware?: Type<NestMiddleware>[];
  /** '*' = all registered models, array = subset by slug */
  models: '*' | string[];
  /** Skip the default JWT guard for this group (for public routes) */
  skipAuth?: boolean;
}

export interface MultiTenantConfig {
  enabled?: boolean;
  organizationIdentifierColumn?: 'id' | 'slug' | 'uuid' | string;
  organizationModel?: string;
  userOrganizationModel?: string;
}

export interface NestedConfig {
  path?: string;
  maxOperations?: number;
  allowedModels?: string[] | null;
}

export interface InvitationConfig {
  expiresDays?: number;
  allowedRoles?: string[] | null;
  notificationHandler?: (invitation: any) => Promise<void> | void;
}

export interface AuthConfig {
  jwtSecret?: string;
  jwtExpiresIn?: string;
  userModel?: string;
  passwordField?: string;
  emailField?: string;
}

export interface PostmanConfig {
  roleModel?: string;
  userRoleModel?: string;
  userModel?: string;
}

export interface RhinoConfig {
  /**
   * The consuming app's PrismaClient instance. Optional at the interface level
   * so tests can construct a config without Prisma, but `RhinoModule.forRoot`
   * expects it in production use.
   */
  prismaClient?: PrismaClientLike;
  models: Record<string, ModelRegistration>;
  routeGroups?: Record<string, RouteGroupConfig>;
  multiTenant?: MultiTenantConfig;
  nested?: NestedConfig;
  invitations?: InvitationConfig;
  auth?: AuthConfig;
  postman?: PostmanConfig;
  clientPath?: string;
  mobilePath?: string;
  testFramework?: 'jest' | 'vitest';
}

export interface RhinoModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => Promise<RhinoConfig> | RhinoConfig;
  /**
   * Middleware classes referenced in `models[*].middleware` / `actionMiddleware`.
   * NestJS requires providers be declared synchronously, so for async config
   * the user must list them here to enable auto-wiring.
   */
  middleware?: Type<NestMiddleware>[];
}
