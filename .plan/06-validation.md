# 06 Validation

**What it does:** Validates request data on store and update endpoints. Supports format rules (Zod schemas), role-keyed validation rules (different fields per role), cross-tenant FK validation (auto-scopes `exists` checks to the current organization), and forbidden field detection.

**Laravel equivalent:** `Traits/HasValidation.php`.

**NestJS implementation:**

Zod schemas are defined per model in the configuration. The `ValidationService` resolves the applicable schema based on the action and user's role:

```typescript
@Injectable()
export class ValidationService {
  validateForAction(
    data: Record<string, any>,
    modelConfig: ModelRegistration,
    action: 'store' | 'update',
    user: any,
    organization?: any,
  ): { valid: boolean; errors?: Record<string, string[]>; validated?: Record<string, any> } {
    
    // 1. Resolve permitted fields from policy
    const permittedFields = this.resolvePermittedFields(modelConfig, user, action);
    
    // 2. Check for forbidden fields
    const forbidden = this.findForbiddenFields(data, permittedFields);
    if (forbidden.length > 0) {
      return { valid: false, errors: { _forbidden: forbidden } };
    }
    
    // 3. Pick the Zod schema and filter to permitted fields
    let schema = modelConfig.validation;
    if (permittedFields[0] !== '*') {
      schema = schema.pick(Object.fromEntries(permittedFields.map(f => [f, true])));
    }
    
    // 4. Scope exists rules to organization (cross-tenant FK)
    // This is done by adding .refine() checks for FK fields
    
    // 5. Validate
    const result = schema.safeParse(data);
    if (!result.success) {
      return { valid: false, errors: this.formatZodErrors(result.error) };
    }
    
    return { valid: true, validated: result.data };
  }
}
```

**Cross-tenant FK validation:**

The most complex part. When a model has a foreignId field (e.g., `project_id`), and the app is multi-tenant, the validation must ensure the referenced record belongs to the same organization. This maps to Laravel's `scopeExistsRulesToOrganization()`.

In the NestJS version, this is done by adding async refinements to the Zod schema:

```typescript
// For each FK field, add a refinement that checks the referenced record
// exists and belongs to the current org
schema = schema.refine(async (data) => {
  if (data.project_id) {
    const project = await prisma.project.findFirst({
      where: { id: data.project_id, organizationId: orgId },
    });
    if (!project) return false;
  }
  return true;
}, { message: 'Referenced record not found in this organization' });
```

For indirect FK chains (e.g., comment -> task -> project -> organization), the `FkChainWalker` utility traverses Prisma's schema metadata to find the path to `organizationId`.

**Files to create:**
- `/src/services/validation.service.ts`
- `/src/pipes/validation.pipe.ts`
- `/src/utils/fk-chain-walker.ts`
- `/src/utils/zod-helpers.ts`

**Tests:**
- Valid data passes validation
- Missing required field returns 422
- Forbidden field returns 403
- Cross-tenant FK: valid FK in same org passes, FK from different org fails with 422
- Indirect FK chain validation (3 levels deep)
- Role-keyed validation: admin can set all fields, member cannot set priority

**Dependencies:** 02, 05 (needs permitted fields from policy).

---
