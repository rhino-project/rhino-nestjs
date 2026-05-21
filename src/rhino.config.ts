import { Inject, Injectable } from '@nestjs/common';
import { RHINO_CONFIG } from './constants/tokens';
import type {
  RhinoConfig,
  ModelRegistration,
  RouteGroupConfig,
} from './interfaces/rhino-config.interface';

/**
 * Injectable accessor for the consuming app's Rhino configuration.
 * Wraps the raw config object with convenience lookup methods.
 */
@Injectable()
export class RhinoConfigService {
  constructor(@Inject(RHINO_CONFIG) private readonly config: RhinoConfig) {}

  raw(): RhinoConfig {
    return this.config;
  }

  models(): Record<string, ModelRegistration> {
    return this.config.models ?? {};
  }

  model(slug: string): ModelRegistration | undefined {
    return this.config.models?.[slug];
  }

  hasModel(slug: string): boolean {
    return Boolean(this.config.models?.[slug]);
  }

  routeGroups(): Record<string, RouteGroupConfig> {
    return this.config.routeGroups ?? {};
  }

  routeGroup(name: string): RouteGroupConfig | undefined {
    return this.config.routeGroups?.[name];
  }

  /**
   * Get all model slugs registered inside a route group.
   * `'*'` expands to every registered model.
   */
  modelsInRouteGroup(name: string): string[] {
    const group = this.routeGroup(name);
    if (!group) return [];
    if (group.models === '*') return Object.keys(this.models());
    return group.models;
  }

  multiTenantEnabled(): boolean {
    const mt = this.config.multiTenant;
    if (!mt) return false;
    if (mt.enabled === false) return false;
    return Boolean(mt.organizationIdentifierColumn) || mt.enabled === true;
  }

  organizationIdentifierColumn(): string {
    return this.config.multiTenant?.organizationIdentifierColumn ?? 'id';
  }

  nestedConfig() {
    return {
      path: this.config.nested?.path ?? 'nested',
      maxOperations: this.config.nested?.maxOperations ?? 50,
      allowedModels: this.config.nested?.allowedModels ?? null,
    };
  }

  invitationsConfig() {
    return {
      expiresDays: this.config.invitations?.expiresDays ?? 7,
      allowedRoles: this.config.invitations?.allowedRoles ?? null,
      notificationHandler: this.config.invitations?.notificationHandler,
    };
  }

  authConfig() {
    return {
      jwtSecret:
        this.config.auth?.jwtSecret ??
        process.env.JWT_SECRET ??
        'change-me-in-production',
      jwtExpiresIn: this.config.auth?.jwtExpiresIn ?? '7d',
      userModel: this.config.auth?.userModel ?? 'user',
      emailField: this.config.auth?.emailField ?? 'email',
      passwordField: this.config.auth?.passwordField ?? 'password',
    };
  }
}

/**
 * Normalize a raw config value (defaults applied) — used by the module in forRoot.
 */
export function normalizeConfig(config: RhinoConfig): RhinoConfig {
  return {
    ...config,
    models: config.models ?? {},
    routeGroups: config.routeGroups ?? {},
    multiTenant: config.multiTenant ?? { enabled: false },
    nested: {
      path: 'nested',
      maxOperations: 50,
      allowedModels: null,
      ...(config.nested ?? {}),
    },
    invitations: {
      expiresDays: 7,
      allowedRoles: null,
      ...(config.invitations ?? {}),
    },
    auth: {
      jwtExpiresIn: '7d',
      userModel: 'user',
      emailField: 'email',
      passwordField: 'password',
      ...(config.auth ?? {}),
    },
  };
}
