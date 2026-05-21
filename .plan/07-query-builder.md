# 07 Query Builder

**What it does:** Supports `?filter[field]=value`, `?sort=-field,field2`, `?search=term`, `?per_page=N&page=N`, `?fields[model]=id,title`, and `?include=relation1,relation2.nested`.

**Laravel equivalent:** `GlobalController.php` lines 102-157, powered by Spatie Query Builder.

**NestJS implementation:**

A `QueryBuilderService` that parses query parameters and translates them to Prisma query arguments:

```typescript
@Injectable()
export class QueryBuilderService {
  buildQuery(
    query: Record<string, any>,
    modelConfig: ModelRegistration,
  ): PrismaQueryArgs {
    return {
      where: this.buildFilters(query, modelConfig.allowedFilters),
      orderBy: this.buildSorts(query, modelConfig.allowedSorts, modelConfig.defaultSort),
      select: this.buildFieldSelection(query, modelConfig.allowedFields),
      include: this.buildIncludes(query, modelConfig.allowedIncludes),
      ...this.buildPagination(query, modelConfig),
      ...this.buildSearch(query, modelConfig.allowedSearch),
    };
  }
}
```

**Filtering** (`?filter[status]=published&filter[user_id]=1`):

```typescript
private buildFilters(query: any, allowedFilters?: string[]) {
  const filters = query.filter || {};
  const where: any = {};
  
  for (const [field, value] of Object.entries(filters)) {
    if (!allowedFilters?.includes(field)) continue;
    
    // Multiple values = OR (e.g., filter[status]=draft,published)
    if (typeof value === 'string' && value.includes(',')) {
      where[field] = { in: value.split(',') };
    } else {
      where[field] = value;
    }
  }
  
  return where;
}
```

**Sorting** (`?sort=-created_at,title`):

```typescript
private buildSorts(query: any, allowedSorts?: string[], defaultSort?: string) {
  const sortParam = query.sort || defaultSort;
  if (!sortParam) return undefined;
  
  return sortParam.split(',').map(s => {
    const desc = s.startsWith('-');
    const field = desc ? s.slice(1) : s;
    if (!allowedSorts?.includes(field)) return null;
    return { [field]: desc ? 'desc' : 'asc' };
  }).filter(Boolean);
}
```

**Search** (`?search=term`):

```typescript
private buildSearch(query: any, allowedSearch?: string[]) {
  if (!query.search || !allowedSearch) return {};
  const term = query.search.toLowerCase();
  
  return {
    OR: allowedSearch.map(col => {
      if (col.includes('.')) {
        // Relationship search: user.name -> { user: { name: { contains: term } } }
        const [relation, field] = col.split('.');
        return { [relation]: { [field]: { contains: term, mode: 'insensitive' } } };
      }
      return { [col]: { contains: term, mode: 'insensitive' } };
    }),
  };
}
```

**Pagination headers** (matching Laravel exactly):

```typescript
// Set response headers
res.header('X-Current-Page', String(page));
res.header('X-Last-Page', String(Math.ceil(total / perPage)));
res.header('X-Per-Page', String(perPage));
res.header('X-Total', String(total));
```

**Include authorization** (matching Laravel's `authorizeIncludes()`): For each requested include, check that the user has `viewAny` permission on the related model. If not, return 403.

**Files to create:**
- `/src/services/query-builder.service.ts`
- `/src/interfaces/parsed-query.interface.ts`

**Tests:**
- Single filter, multiple filters (AND), multiple values (OR)
- Sort ascending, descending, multiple sorts, default sort
- Search across direct fields and relationship fields
- Pagination with X-* headers
- Field selection
- Eager loading with nested includes
- Include authorization (403 when user lacks viewAny on related model)
- Unknown filter/sort silently ignored (not an error)

**Dependencies:** 03.

---
