# 22 Auto Scope

**What it does:** Automatic scope discovery and application. Scopes are classes that modify queries based on context (e.g., a `TaskScope` that filters by `assignedTo` for member role users).

**Laravel equivalent:** `Traits/HasAutoScope.php`, `Scopes/` directory.

**NestJS implementation:**

Scopes are functions that receive the Prisma where clause and request context, and return a modified where clause:

```typescript
// User-defined scope
export class TaskScope implements RhinoScope {
  apply(where: any, context: ScopeContext): any {
    if (context.user && context.userRole === 'member') {
      return { ...where, assignedTo: context.user.id };
    }
    return where;
  }
}
```

Scopes are registered in model config:

```typescript
models: {
  tasks: {
    model: 'Task',
    scopes: [TaskScope],
  },
}
```

Auto-discovery by naming convention (matching Laravel): Look for a file at `src/scopes/{ModelName}Scope.ts`.

**Files to create:**
- `/src/interfaces/scope.interface.ts`
- `/src/services/scope.service.ts`

**Dependencies:** 02, 03.

---
