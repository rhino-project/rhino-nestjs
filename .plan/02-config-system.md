# 02 Config System

**What it does:** Defines how models are registered, route groups are configured, and the module is initialized. This is the NestJS equivalent of `config/rhino.php`.

**Laravel equivalent:** `config/rhino.php`, `GlobalControllerServiceProvider`.

**NestJS implementation:**

A dynamic module pattern with `forRoot()` and `forRootAsync()`:

```typescript
// In the consuming app:
@Module({
  imports: [
    RhinoModule.forRoot({
      models: {
        posts: { model: 'Post', policy: PostPolicy },
        comments: { model: 'Comment', policy: CommentPolicy },
      },
      routeGroups: {
        tenant: {
          prefix: ':organization',
          middleware: [ResolveOrganizationMiddleware],
          models: '*',
        },
        public: {
          prefix: 'public',
          middleware: [],
          models: ['categories'],
        },
      },
      multiTenant: {
        organizationIdentifierColumn: 'slug',
      },
      nested: {
        path: 'nested',
        maxOperations: 50,
        allowedModels: null,
      },
    }),
    PrismaModule,
  ],
})
export class AppModule {}
```

**Config interface** (`rhino-config.interface.ts`):

```typescript
export interface RhinoConfig {
  models: Record<string, ModelRegistration>;
  routeGroups: Record<string, RouteGroupConfig>;
  multiTenant?: MultiTenantConfig;
  nested?: NestedConfig;
  invitations?: InvitationConfig;
  auth?: AuthConfig;
}

export interface ModelRegistration {
  model: string;                    // Prisma model name
  policy?: Type<ResourcePolicy>;    // Policy class
  validation?: ZodSchema;           // Zod schema for format rules
  validationStore?: ZodSchema;      // Store-specific overrides
  validationUpdate?: ZodSchema;     // Update-specific overrides
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
  owner?: string;                   // Relationship path to org
  belongsToOrganization?: boolean;
  hasAuditTrail?: boolean;
  hasUuid?: boolean;
  computedAttributes?: (record: any, user: any) => Record<string, any>;
}
```

**Files to create:**
- `/src/rhino.module.ts`
- `/src/rhino.config.ts`
- `/src/interfaces/rhino-config.interface.ts`
- `/src/interfaces/model-registration.interface.ts`
- `/src/interfaces/route-group.interface.ts`
- `/src/constants/tokens.ts` -- injection tokens

**Tests:** Module instantiation with various config shapes, missing required fields, invalid route groups.

**Dependencies:** 01-project-setup.

---
