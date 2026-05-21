# 01 Project Setup

**What it does:** Scaffolds the NestJS library project with proper TypeScript configuration, build tooling, and npm package structure.

**Laravel equivalent:** `composer.json`, `phpunit.xml`, package service provider.

**NestJS implementation:**

The project is a publishable NestJS library built with `nest build`. It is published as `@rhino-project/rhino-nestjs` on npm.

**Package structure:**

```
package.json         # name: @rhino-project/rhino-nestjs
tsconfig.json        # strict mode, paths, declaration files
tsconfig.build.json  # build-only config
nest-cli.json        # NestJS build configuration
src/
  index.ts           # Public API exports
  rhino.module.ts
  ...
test/
  jest-e2e.json
  setup.ts
```

**Key package.json dependencies:**

```json
{
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "dependencies": {
    "zod": "^3.22.0",
    "js-yaml": "^4.1.0",
    "jsonwebtoken": "^9.0.0",
    "@nestjs/passport": "^10.0.0",
    "passport-jwt": "^4.0.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "prisma": "^5.0.0",
    "jest": "^29.0.0",
    "supertest": "^6.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Files to create:**
- `/src/index.ts` -- barrel exports
- `/package.json`
- `/tsconfig.json`
- `/tsconfig.build.json`
- `/nest-cli.json`
- `/jest.config.ts`
- `/README.md`
- `/.npmignore`

**Tests:** Verify the module can be imported, `RhinoModule.forRoot()` returns a valid dynamic module, and all public exports are accessible.

**Dependencies:** None (this is the foundation).

---
