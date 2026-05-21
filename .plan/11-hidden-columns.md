# 11 Hidden Columns

**What it does:** Per-role field visibility in API responses. Combines base hidden columns (password, timestamps), model-level additional hidden columns, and policy-level dynamic hiding based on the authenticated user's role.

**Laravel equivalent:** `Traits/HidableColumns.php`.

**NestJS implementation:**

A `SerializerService` that applies field visibility rules:

```typescript
@Injectable()
export class SerializerService {
  serializeRecord(record: any, modelConfig: ModelRegistration, user: any): any {
    let result = { ...record };
    
    // 1. Remove base hidden columns
    const baseHidden = ['password', 'rememberToken', 'hasTemporaryPassword',
                        'updatedAt', 'createdAt', 'deletedAt', 'emailVerifiedAt'];
    for (const col of baseHidden) delete result[col];
    
    // 2. Remove model-level additional hidden columns
    // (from modelConfig.additionalHiddenColumns)
    
    // 3. Apply policy blacklist (hiddenAttributesForShow)
    if (modelConfig.policy) {
      const policy = new modelConfig.policy();
      const hidden = policy.hiddenAttributesForShow(user);
      for (const col of hidden) delete result[col];
    }
    
    // 4. Apply policy whitelist (permittedAttributesForShow)
    if (modelConfig.policy) {
      const policy = new modelConfig.policy();
      const permitted = policy.permittedAttributesForShow(user);
      if (permitted[0] !== '*') {
        const allowedSet = new Set([...permitted, 'id']);
        result = Object.fromEntries(
          Object.entries(result).filter(([k]) => allowedSet.has(k))
        );
      }
    }
    
    // 5. Add computed attributes
    if (modelConfig.computedAttributes) {
      Object.assign(result, modelConfig.computedAttributes(record, user));
    }
    
    return result;
  }
}
```

**Files to create:**
- `/src/services/serializer.service.ts`
- `/src/interceptors/hidden-columns.interceptor.ts`

**Tests:** Base hidden columns removed, policy blacklist applied, policy whitelist applied, computed attributes included, 'id' always included even with whitelist.

**Dependencies:** 05.

---
