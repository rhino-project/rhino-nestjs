# 15 Claude Skills

**What it does:** Ships 13 Claude Code slash commands (`.md` files) that help developers build features, write tests, create models, etc. These are installed to `.claude/commands/` in the user's project.

**Laravel equivalent:** `stubs/skills/rhino-*.md` (13 files).

**NestJS implementation:**

Port each of the 13 Laravel skill files, adapting references from PHP/Laravel to TypeScript/NestJS/Prisma:

1. `rhino-feature.md` -- Add a new feature (TDD flow)
2. `rhino-model.md` -- Create a model definition
3. `rhino-policy.md` -- Create an authorization policy
4. `rhino-scope.md` -- Create a custom scope
5. `rhino-test.md` -- Write tests
6. `rhino-review.md` -- Review code
7. `rhino-refactor.md` -- Refactor code
8. `rhino-bugfix.md` -- Fix a bug (TDD)
9. `rhino-audit.md` -- Add audit trail
10. `rhino-docs.md` -- Update documentation
11. `rhino-migrate.md` -- Create/update Prisma migration
12. `rhino-deploy.md` -- Deployment guide
13. `rhino-plan.md` -- Plan before coding

**Files to create:**
- `/stubs/skills/rhino-feature.md` (and 12 more)

**Dependencies:** All other features (skills reference them).

---
