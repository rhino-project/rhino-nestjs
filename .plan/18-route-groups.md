# 18 Route Groups

**What it does:** Multiple route prefixes with different middleware stacks. Supports `tenant` (org-scoped), `public` (no auth), and custom named groups with their own model subsets.

**Laravel equivalent:** `config/rhino.php` route_groups, route registration in ServiceProvider.

**NestJS implementation:**

Routes are registered dynamically based on the `routeGroups` configuration. For each group:
- If group name is `'public'`, skip the JWT guard
- If group name is `'tenant'`, register invitation and nested routes under this prefix
- Apply the group's middleware stack on top of the base middleware

The `GlobalController` inspects `req.routeGroup` (set by a route-group-resolving middleware) to determine the current context.

**Files to create:**
- `/src/services/route-registration.service.ts`
- `/src/middleware/route-group.middleware.ts`

**Dependencies:** 02, 03, 08.

---
