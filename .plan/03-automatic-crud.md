# 03 Automatic Crud

**What it does:** Auto-generates CRUD endpoints (index, show, store, update, destroy) for every registered model. This is THE core feature -- the NestJS equivalent of `GlobalController.php`.

**Laravel equivalent:** `Controllers/GlobalController.php` (lines 1-350).

**NestJS implementation:**

A single `GlobalController` handles all models via dynamic route params. The controller uses `@All()` with a route parameter pattern that captures the model slug and optional ID.

```typescript
@Controller('api')
export class GlobalController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly queryBuilderService: QueryBuilderService,
    private readonly serializerService: SerializerService,
    private readonly validationService: ValidationService,
  ) {}

  // Registered dynamically per route group in onModuleInit
}
```

However, NestJS requires known routes at compile time. The solution is to use `DynamicModule` to register routes programmatically in `onModuleInit`:

```typescript
// Inside RhinoModule
export class RhinoModule implements OnModuleInit {
  onModuleInit() {
    const router = this.moduleRef.get(Router);
    const config = this.moduleRef.get(RHINO_CONFIG);
    
    for (const [groupName, groupConfig] of Object.entries(config.routeGroups)) {
      const models = resolveModelsForGroup(config.models, groupConfig);
      for (const [slug, modelConfig] of Object.entries(models)) {
        // Register: GET /api/{prefix}/{slug}
        // Register: GET /api/{prefix}/{slug}/:id
        // Register: POST /api/{prefix}/{slug}
        // Register: PUT /api/{prefix}/{slug}/:id
        // Register: DELETE /api/{prefix}/{slug}/:id
      }
    }
  }
}
```

Alternatively (and more NestJS-native), use a `RouterModule` approach where routes are registered dynamically using `@nestjs/core`'s `RouterModule.register()`.

The preferred approach is a **middleware-based dynamic router**. A single controller with wildcard routes handles all models:

```typescript
@Controller('api/:routePrefix?')
@UseGuards(AuthGuard('jwt'))
export class GlobalController {
  @Get(':modelSlug')
  async index(
    @Param('modelSlug') modelSlug: string,
    @Param('routePrefix') routePrefix: string,
    @Query() query: any,
    @Req() req: Request,
  ) {
    const modelConfig = this.resolveModel(modelSlug, routePrefix);
    // ... authorization, query building, serialization
  }
  
  @Get(':modelSlug/:id')
  async show(...) { /* ... */ }
  
  @Post(':modelSlug')
  async store(...) { /* ... */ }
  
  @Put(':modelSlug/:id')
  async update(...) { /* ... */ }
  
  @Delete(':modelSlug/:id')
  async destroy(...) { /* ... */ }
}
```

**ResourceService** (`resource.service.ts`):

The service encapsulates all Prisma operations. It delegates to the `PrismaService` and maps model slugs to Prisma model names:

```typescript
@Injectable()
export class ResourceService {
  constructor(private prisma: PrismaService) {}

  async findAll(modelName: string, query: ParsedQuery, orgId?: number) {
    const prismaModel = this.prisma[modelName];
    const where = this.buildWhereClause(query.filters, orgId);
    const orderBy = this.buildOrderBy(query.sorts);
    const include = this.buildIncludes(query.includes);
    
    if (query.perPage) {
      const [items, total] = await Promise.all([
        prismaModel.findMany({ where, orderBy, include, skip: query.skip, take: query.perPage }),
        prismaModel.count({ where }),
      ]);
      return { items, total, page: query.page, perPage: query.perPage };
    }
    
    return { items: await prismaModel.findMany({ where, orderBy, include }) };
  }
  
  async findOne(modelName: string, id: string | number, orgId?: number) { ... }
  async create(modelName: string, data: any, orgId?: number) { ... }
  async update(modelName: string, id: string | number, data: any, orgId?: number) { ... }
  async delete(modelName: string, id: string | number, orgId?: number) { ... }
}
```

**Response format:**

Index: `{ data: [...] }` with headers `X-Current-Page`, `X-Last-Page`, `X-Per-Page`, `X-Total`.
Show: `{ id: 1, title: "..." }` (single object, no wrapping).
Store: 201 status, serialized record.
Update: 200 status, serialized record.
Destroy: 204 status, no body.

**Files to create:**
- `/src/controllers/global.controller.ts`
- `/src/services/resource.service.ts`
- `/src/services/model-resolver.service.ts`

**Tests:**
- CRUD operations for a test model (Post with title, content, status)
- 404 for unknown model slug
- 201 on successful create
- 204 on successful delete
- Proper response format for index (wrapped in data) and show (unwrapped)
- Pagination headers when perPage is set

**Dependencies:** 01, 02.

---
