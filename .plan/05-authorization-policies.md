# 05 Authorization Policies

**What it does:** Convention-based authorization using `{slug}.{action}` permissions. Each CRUD action checks the user's permissions before executing. Supports wildcards (`*`, `posts.*`), per-role attribute permissions (read/write), and hidden columns.

**Laravel equivalent:** `Policies/ResourcePolicy.php`, `Traits/HasPermissions.php`.

**NestJS implementation:**

A `ResourcePolicyGuard` that checks permissions using the same convention as Laravel:

```typescript
@Injectable()
export class ResourcePolicyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const modelSlug = request.params.modelSlug;
    const action = this.resolveAction(request.method, request.params);
    const organization = request.organization; // set by middleware
    
    return this.checkPermission(user, `${modelSlug}.${action}`, organization);
  }
  
  private resolveAction(method: string, params: any): string {
    // GET with id -> 'show', GET without -> 'index'
    // POST -> 'store', PUT -> 'update', DELETE -> 'destroy'
  }
  
  private checkPermission(user: any, permission: string, org?: any): boolean {
    const slug = permission.split('.')[0];
    const permissions = org
      ? this.getOrgPermissions(user, org)  // tenant: user_roles.permissions
      : user.permissions ?? [];             // non-tenant: users.permissions
    
    return permissions.some(p => 
      p === permission || p === '*' || p === `${slug}.*`
    );
  }
}
```

**Policy classes** for custom authorization:

```typescript
export abstract class ResourcePolicy {
  resourceSlug?: string;
  
  viewAny(user: any): boolean { return this.checkPermission(user, 'index'); }
  view(user: any, model: any): boolean { return this.checkPermission(user, 'show'); }
  create(user: any): boolean { return this.checkPermission(user, 'store'); }
  update(user: any, model: any): boolean { return this.checkPermission(user, 'update'); }
  delete(user: any, model: any): boolean { return this.checkPermission(user, 'destroy'); }
  
  // Soft delete actions
  viewTrashed(user: any): boolean { return this.checkPermission(user, 'trashed'); }
  restore(user: any, model: any): boolean { return this.checkPermission(user, 'restore'); }
  forceDelete(user: any, model: any): boolean { return this.checkPermission(user, 'forceDelete'); }
  
  // Attribute permissions
  permittedAttributesForShow(user: any): string[] { return ['*']; }
  hiddenAttributesForShow(user: any): string[] { return []; }
  permittedAttributesForCreate(user: any): string[] { return ['*']; }
  permittedAttributesForUpdate(user: any): string[] { return ['*']; }
  
  protected hasRole(user: any, role: string, org?: any): boolean { ... }
}
```

**Files to create:**
- `/src/guards/resource-policy.guard.ts`
- `/src/policies/resource-policy.ts`
- `/src/interfaces/policy.interface.ts`
- `/src/utils/permission-matcher.ts`

**Tests:**
- Permission check with exact match, wildcard `*`, resource wildcard `posts.*`
- 403 when user lacks permission
- Tenant vs non-tenant permission sources
- Custom policy override
- Attribute permissions (permittedAttributesForCreate/Update/Show)

**Dependencies:** 04 (needs authenticated user).

---
