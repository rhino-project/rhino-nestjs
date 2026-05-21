# 08 Multi Tenancy

**What it does:** Organization-based data isolation. Routes are prefixed with `/:organization`, middleware resolves the org from the URL, all queries are automatically scoped, and `organizationId` is auto-set on create.

**Laravel equivalent:** `Traits/BelongsToOrganization.php`, `Http/Middleware/ResolveOrganizationFromRoute.php`, `GlobalController::applyOrganizationScope()`.

**NestJS implementation:**

**ResolveOrganizationMiddleware:**

```typescript
@Injectable()
export class ResolveOrganizationMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService, private config: RhinoConfig) {}
  
  async use(req: Request, res: Response, next: NextFunction) {
    const orgIdentifier = req.params.organization;
    if (!orgIdentifier) return next();
    
    const identifierColumn = this.config.multiTenant?.organizationIdentifierColumn || 'id';
    
    const org = await this.prisma.organization.findFirst({
      where: { [identifierColumn]: orgIdentifier },
    });
    
    if (!org) throw new NotFoundException('Organization not found');
    
    // Check user belongs to org
    if (req.user) {
      const membership = await this.prisma.userRole.findFirst({
        where: { userId: req.user.id, organizationId: org.id },
      });
      if (!membership) throw new NotFoundException('Organization not found');
    }
    
    req.organization = org;
    next();
  }
}
```

**Organization scoping in ResourceService:**

The `applyOrganizationScope()` method mirrors Laravel's implementation exactly, including:

1. Direct scoping: model has `organizationId` field -> add `where: { organizationId: orgId }`
2. Owner property: model config has `owner: 'project'` -> use `whereHas` equivalent
3. Auto-detection: walk BelongsTo relationships to find the path to Organization (up to 3 levels deep)

```typescript
private applyOrganizationScope(modelConfig: ModelRegistration, where: any, org: any): any {
  if (!org) return where;
  
  // Check if model IS the Organization
  if (modelConfig.model === 'Organization') {
    return { ...where, id: org.id };
  }
  
  // Direct: model has organizationId
  if (modelConfig.belongsToOrganization) {
    return { ...where, organizationId: org.id };
  }
  
  // Owner: explicit relationship path
  if (modelConfig.owner) {
    if (modelConfig.owner === 'none') return where;
    return this.buildNestedWhere(where, modelConfig.owner, org.id);
  }
  
  // Auto-detect: walk Prisma schema relationships
  const path = this.findOrganizationPath(modelConfig.model);
  if (path) {
    return this.buildNestedWhere(where, path, org.id);
  }
  
  return where; // No org relationship found, model is global
}
```

**Auto-set organizationId on create:**

In the store action, if the model has `belongsToOrganization: true` and an organization is on the request, inject `organizationId` into the data before calling `prisma.create()`.

**Strip organizationId from user input:**

On store, silently remove `organizationId` from request body (it is set by the framework). On update, reject any attempt to change `organizationId` with a 403.

**Files to create:**
- `/src/middleware/resolve-organization.middleware.ts`
- `/src/services/organization.service.ts`
- `/src/utils/org-path-finder.ts`

**Tests:**
- Org resolved from route parameter (by id, slug, uuid)
- 404 when org does not exist
- 404 when user does not belong to org
- Data scoped to current org (org A data invisible to org B)
- Auto-set organizationId on create
- organizationId stripped from user input on store
- organizationId change rejected with 403 on update
- Indirect org scoping (task -> project -> org)
- 3-level indirect scoping (comment -> task -> project -> org)
- Auto-detection of org path via BelongsTo chain

**Dependencies:** 02, 03, 04.

---
