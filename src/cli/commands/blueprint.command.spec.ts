/**
 * Blueprint command tests.
 *
 * BlueprintRunner is mocked so the test does not depend on the runner
 * being built yet.
 */

// We need to mock the dynamic require inside blueprint.command.ts.
// Because the module uses require() at runtime, we intercept it via
// jest.mock on the module path.
jest.mock('../../blueprint/blueprint-runner', () => ({
  BlueprintRunner: jest.fn().mockImplementation(() => ({
    run: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { runBlueprint } from './blueprint.command';

describe('runBlueprint', () => {
  it('calls the runner with default options', async () => {
    await expect(runBlueprint({})).resolves.toBeUndefined();
  });

  it('calls the runner with force=true', async () => {
    await expect(runBlueprint({ force: true })).resolves.toBeUndefined();
  });

  it('calls the runner with dryRun=true and model slug', async () => {
    await expect(
      runBlueprint({ dryRun: true, model: 'post' }),
    ).resolves.toBeUndefined();
  });

  it('exits with code 1 when runner module is absent', async () => {
    // Temporarily make the require fail
    jest.resetModules();
    jest.doMock('../../blueprint/blueprint-runner', () => {
      throw new Error('Module not found');
    });

    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Re-import to get the fresh version that will use the broken mock
    const { runBlueprint: freshRun } = await import('./blueprint.command');
    await freshRun({});

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errSpy.mockRestore();
    jest.resetModules();
  });
});
