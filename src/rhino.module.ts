import {
  DynamicModule,
  Global,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
  Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RhinoConfigService, normalizeConfig } from './rhino.config';
import {
  RHINO_CONFIG,
  RHINO_MODULE_OPTIONS,
  RHINO_PRISMA_CLIENT,
} from './constants/tokens';
import type {
  RhinoConfig,
  RhinoModuleAsyncOptions,
} from './interfaces/rhino-config.interface';
import { PrismaService } from './prisma/prisma.service';
import { ResourceService } from './services/resource.service';
import { QueryBuilderService } from './services/query-builder.service';
import { SerializerService } from './services/serializer.service';
import { ValidationService } from './services/validation.service';
import { OrganizationService } from './services/organization.service';
import { AuditService } from './services/audit.service';
import { NestedService } from './services/nested.service';
import { ScopeService } from './services/scope.service';
import { AuthService } from './services/auth.service';
import { InvitationService } from './services/invitation.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ResourcePolicyGuard } from './guards/resource-policy.guard';
import { GlobalController } from './controllers/global.controller';
import { AuthController } from './controllers/auth.controller';
import { InvitationController } from './controllers/invitation.controller';
import { NestedController } from './controllers/nested.controller';
import { RouteGroupMiddleware } from './middleware/route-group.middleware';
import { ResolveOrganizationMiddleware } from './middleware/resolve-organization.middleware';

const ACTION_TO_METHOD: Record<string, RequestMethod> = {
  index: RequestMethod.GET,
  show: RequestMethod.GET,
  store: RequestMethod.POST,
  update: RequestMethod.PUT,
  destroy: RequestMethod.DELETE,
  trashed: RequestMethod.GET,
  restore: RequestMethod.POST,
  forceDelete: RequestMethod.DELETE,
};

function actionPath(slug: string, action: string): string {
  switch (action) {
    case 'index':
    case 'store':
      return slug;
    case 'trashed':
      return `${slug}/trashed`;
    case 'show':
    case 'update':
    case 'destroy':
      return `${slug}/:id`;
    case 'restore':
      return `${slug}/:id/restore`;
    case 'forceDelete':
      return `${slug}/:id/force-delete`;
    default:
      return slug;
  }
}

export interface RhinoModuleOptions {
  /** Register the library's controllers automatically. Default true. */
  registerControllers?: boolean;
  /** Install JwtAuthGuard globally as APP_GUARD. Default false (opt-in). */
  autoAuthGuard?: boolean;
  /** Install ResourcePolicyGuard globally as APP_GUARD. Default false (opt-in). */
  autoPolicyGuard?: boolean;
  /** Install RouteGroupMiddleware globally. Default true. */
  autoRouteGroupMiddleware?: boolean;
  /** Wire per-model `middleware` / `actionMiddleware` via NestModule.configure. Default true. */
  autoModelMiddleware?: boolean;
  /** Wire ResolveOrganizationMiddleware for all routes when multiTenant enabled. Default true. */
  autoTenantMiddleware?: boolean;
}

/**
 * Rhino NestJS dynamic module.
 *
 * Example (synchronous):
 *
 *   RhinoModule.forRoot({
 *     prismaClient: new PrismaClient(),
 *     models: {
 *       posts: { model: 'post', policy: PostPolicy, belongsToOrganization: true },
 *     },
 *   });
 *
 * Example (async — reading from a ConfigService):
 *
 *   RhinoModule.forRootAsync({
 *     imports: [ConfigModule],
 *     inject: [ConfigService, PrismaService],
 *     middleware: [MyRateLimitMw],      // <-- list middleware classes here
 *     useFactory: (cfg, prisma) => ({
 *       prismaClient: prisma,
 *       models: { ... },
 *     }),
 *   });
 */
@Global()
@Module({})
export class RhinoModule implements NestModule {
  constructor(
    @Inject(RHINO_CONFIG) private readonly config: RhinoConfig,
    @Inject(RHINO_MODULE_OPTIONS) private readonly options: RhinoModuleOptions,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    const opts = this.options ?? {};
    const cfg = this.config;
    if (!cfg) return;

    if (opts.autoRouteGroupMiddleware !== false) {
      consumer.apply(RouteGroupMiddleware).forRoutes('*');
    }

    if (opts.autoModelMiddleware !== false) {
      for (const [slug, reg] of Object.entries(cfg.models ?? {})) {
        const baseMw = (reg.middleware ?? []) as Type<any>[];
        if (baseMw.length > 0) {
          consumer.apply(...baseMw).forRoutes(
            { path: slug, method: RequestMethod.ALL },
            { path: `${slug}/*`, method: RequestMethod.ALL },
          );
        }
        for (const [action, mwList] of Object.entries(reg.actionMiddleware ?? {})) {
          const list = (mwList ?? []) as Type<any>[];
          if (list.length === 0) continue;
          const method = ACTION_TO_METHOD[action] ?? RequestMethod.ALL;
          consumer.apply(...list).forRoutes({ path: actionPath(slug, action), method });
        }
      }
    }

    if (
      opts.autoTenantMiddleware !== false &&
      (cfg.multiTenant?.organizationIdentifierColumn || cfg.multiTenant?.enabled)
    ) {
      consumer.apply(ResolveOrganizationMiddleware).forRoutes('*');
    }
  }

  /**
   * Synchronous registration. All middleware classes are collected from the
   * passed config at build time, so no extra `middleware` option is needed.
   */
  static forRoot(
    config: RhinoConfig,
    options: RhinoModuleOptions = {},
  ): DynamicModule {
    const normalized = normalizeConfig(config);
    const middlewareFromConfig = RhinoModule.collectModelMiddleware(normalized);
    return RhinoModule.build({
      configProviders: [
        { provide: RHINO_CONFIG, useValue: normalized },
        {
          provide: RHINO_PRISMA_CLIENT,
          useValue: normalized.prismaClient ?? null,
        },
      ],
      imports: [],
      options,
      middlewareClasses: middlewareFromConfig,
    });
  }

  /**
   * Asynchronous registration. Middleware classes referenced by models must
   * be declared via `options.middleware` because NestJS providers cannot be
   * resolved from an async useFactory.
   */
  static forRootAsync(
    options: RhinoModuleAsyncOptions & RhinoModuleOptions,
  ): DynamicModule {
    const configProvider: Provider = {
      provide: RHINO_CONFIG,
      useFactory: async (...args: any[]) => normalizeConfig(await options.useFactory(...args)),
      inject: options.inject ?? [],
    };
    const prismaProvider: Provider = {
      provide: RHINO_PRISMA_CLIENT,
      useFactory: (cfg: RhinoConfig) => cfg.prismaClient ?? null,
      inject: [RHINO_CONFIG],
    };
    return RhinoModule.build({
      configProviders: [configProvider, prismaProvider],
      imports: options.imports ?? [],
      options,
      middlewareClasses: (options.middleware ?? []) as Type<any>[],
    });
  }

  private static build(args: {
    configProviders: Provider[];
    imports: any[];
    options: RhinoModuleOptions;
    middlewareClasses: Type<any>[];
  }): DynamicModule {
    const opts = args.options;
    const guardProviders: Provider[] = [];
    if (opts.autoAuthGuard) guardProviders.push({ provide: APP_GUARD, useClass: JwtAuthGuard });
    if (opts.autoPolicyGuard) guardProviders.push({ provide: APP_GUARD, useClass: ResourcePolicyGuard });

    return {
      module: RhinoModule,
      imports: args.imports,
      controllers: opts.registerControllers !== false
        ? [GlobalController, AuthController, InvitationController, NestedController]
        : [],
      providers: [
        ...args.configProviders,
        { provide: RHINO_MODULE_OPTIONS, useValue: opts },
        ...RhinoModule.coreProviders(),
        JwtAuthGuard,
        ResourcePolicyGuard,
        RouteGroupMiddleware,
        ResolveOrganizationMiddleware,
        ...dedupeTypes(args.middlewareClasses),
        ...guardProviders,
      ],
      exports: RhinoModule.coreExports(),
    };
  }

  private static collectModelMiddleware(config: RhinoConfig): Type<any>[] {
    const set = new Set<Type<any>>();
    for (const reg of Object.values(config.models ?? {})) {
      for (const mw of (reg.middleware ?? []) as Type<any>[]) set.add(mw);
      for (const mws of Object.values(reg.actionMiddleware ?? {})) {
        for (const mw of (mws ?? []) as Type<any>[]) set.add(mw);
      }
    }
    return Array.from(set);
  }

  private static coreProviders(): Provider[] {
    return [
      RhinoConfigService,
      PrismaService,
      ResourceService,
      QueryBuilderService,
      SerializerService,
      ValidationService,
      OrganizationService,
      AuditService,
      NestedService,
      ScopeService,
      AuthService,
      InvitationService,
    ];
  }

  private static coreExports() {
    return [
      // Injection tokens (BP-010 — surfaced for consumer middleware/services)
      RHINO_CONFIG,
      RHINO_PRISMA_CLIENT,
      RHINO_MODULE_OPTIONS,
      RhinoConfigService,
      PrismaService,
      ResourceService,
      QueryBuilderService,
      SerializerService,
      ValidationService,
      OrganizationService,
      AuditService,
      NestedService,
      ScopeService,
      AuthService,
      InvitationService,
      JwtAuthGuard,
      ResourcePolicyGuard,
    ];
  }
}

function dedupeTypes(list: Type<any>[]): Type<any>[] {
  const seen = new Set<any>();
  const out: Type<any>[] = [];
  for (const t of list) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
