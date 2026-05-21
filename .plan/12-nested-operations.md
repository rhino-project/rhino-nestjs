# 12 Nested Operations

**What it does:** Atomic multi-model transactions via `POST /nested`. Supports create and update actions with `$N.field` references to previous operation results.

**Laravel equivalent:** `GlobalController.php` lines 1134-1367.

**NestJS implementation:**

```typescript
@Controller('api')
export class NestedController {
  @Post(':routePrefix?/nested')
  async nested(@Body() body: NestedRequestBody, @Req() req: Request) {
    // 1. Validate structure
    // 2. Validate each operation's data
    // 3. Authorize each operation
    // 4. Execute all in a transaction
    // 5. Return results array
  }
}
```

```typescript
@Injectable()
export class NestedService {
  async execute(operations: Operation[], user: any, org?: any): Promise<Result[]> {
    return this.prisma.$transaction(async (tx) => {
      const results: Result[] = [];
      
      for (const [index, op] of operations.entries()) {
        // Resolve $N.field references
        const resolvedData = this.resolveReferences(op.data, results);
        
        if (op.action === 'create') {
          const record = await tx[op.model].create({ data: resolvedData });
          results.push({ model: op.model, action: 'create', id: record.id, data: record });
        } else if (op.action === 'update') {
          const record = await tx[op.model].update({ where: { id: op.id }, data: resolvedData });
          results.push({ model: op.model, action: 'update', id: record.id, data: record });
        }
      }
      
      return results;
    });
  }
  
  private resolveReferences(data: any, results: Result[]): any {
    const resolved = { ...data };
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string' && value.match(/^\$\d+\.\w+$/)) {
        const [indexStr, field] = value.slice(1).split('.');
        const index = parseInt(indexStr);
        resolved[key] = results[index]?.data?.[field];
      }
    }
    return resolved;
  }
}
```

**Files to create:**
- `/src/controllers/nested.controller.ts`
- `/src/services/nested.service.ts`

**Tests:** Create with reference, update with reference, rollback on validation failure, rollback on authorization failure, max operations limit, allowed models restriction.

**Dependencies:** 03, 05, 06.

---
