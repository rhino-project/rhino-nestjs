# 23 Middleware Support

**What it does:** Per-model and per-action middleware/interceptors. For example, applying rate limiting to the `store` action of a specific model.

**Laravel equivalent:** `GlobalController.php` middleware support via model properties.

**NestJS implementation:**

Model config supports middleware arrays:

```typescript
models: {
  tasks: {
    model: 'Task',
    middleware: [RateLimitMiddleware],         // Applied to all actions
    actionMiddleware: {
      store: [ThrottleMiddleware],             // Only on store
    },
  },
}
```

The route registration service applies these middleware when setting up routes.

**Files to create:**
- Middleware application logic in `/src/services/route-registration.service.ts`

**Dependencies:** 02, 03, 18.
