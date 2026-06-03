/**
 * Global test guard against cross-file state pollution.
 *
 * `RhinoConfigService.authConfig()` reads `process.env.JWT_SECRET` as a fallback
 * JWT secret. A test that mutates that env var and fails to restore it (e.g. a
 * failed assertion before its cleanup line) would leak the value into the rest
 * of the jest worker, since workers are reused across test files. That made the
 * suite order-dependent and intermittently flaky.
 *
 * This hook snapshots `JWT_SECRET` before each test and restores it afterwards,
 * so no individual test can leak it regardless of how it fails. It is a cheap,
 * deterministic backstop in addition to per-test save/restore.
 */
let hadJwtSecret = false;
let prevJwtSecret: string | undefined;

beforeEach(() => {
  hadJwtSecret = Object.prototype.hasOwnProperty.call(process.env, 'JWT_SECRET');
  prevJwtSecret = process.env.JWT_SECRET;
});

afterEach(() => {
  if (hadJwtSecret) process.env.JWT_SECRET = prevJwtSecret;
  else delete process.env.JWT_SECRET;
});
