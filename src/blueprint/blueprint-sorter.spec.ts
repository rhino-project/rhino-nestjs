import { BlueprintSorter, SortableBlueprint, SortableColumn } from './blueprint-sorter';

/**
 * Exhaustive coverage for dependency-aware blueprint ordering: parents (referenced
 * models) must be emitted before children (the models that foreign-key to them).
 */
describe('BlueprintSorter', () => {
  let sorter: BlueprintSorter;

  beforeEach(() => {
    sorter = new BlueprintSorter();
  });

  const bp = (
    model: string,
    fkModels: string[] = [],
    extraColumns: SortableColumn[] = [],
  ): SortableBlueprint => {
    const columns: SortableColumn[] = fkModels.map((fk) => ({
      type: 'foreignId',
      foreignModel: fk,
    }));
    return { model, columns: [...columns, ...extraColumns] };
  };

  const names = (bps: SortableBlueprint[]): string[] => bps.map((b) => b.model);

  const assertBefore = (parent: string, child: string, ordered: string[]): void => {
    expect(ordered.indexOf(parent)).toBeLessThan(ordered.indexOf(child));
  };

  const assertSameModelSet = (input: SortableBlueprint[], output: SortableBlueprint[]): void => {
    expect([...names(output)].sort()).toEqual([...names(input)].sort());
  };

  // ── degenerate inputs ────────────────────────────────────────────────

  it('returns empty for empty input', () => {
    expect(sorter.sort([])).toEqual([]);
    expect(sorter.cycles).toEqual([]);
  });

  it('leaves a single model unchanged', () => {
    expect(names(sorter.sort([bp('Post')]))).toEqual(['Post']);
    expect(sorter.cycles).toEqual([]);
  });

  // ── independents: stable order preserved ─────────────────────────────

  it('keeps input order for independent models', () => {
    expect(names(sorter.sort([bp('Apple'), bp('Banana'), bp('Cherry')]))).toEqual([
      'Apple',
      'Banana',
      'Cherry',
    ]);
    expect(sorter.cycles).toEqual([]);
  });

  // ── linear chain ─────────────────────────────────────────────────────

  it('orders a linear chain parents-first', () => {
    const out = names(sorter.sort([bp('Comment', ['Post']), bp('Post', ['Blog']), bp('Blog')]));
    expect(out).toEqual(['Blog', 'Post', 'Comment']);
    expect(sorter.cycles).toEqual([]);
  });

  it('handles a forward reference (child before parent in input)', () => {
    const out = names(sorter.sort([bp('Comment', ['Post']), bp('Post')]));
    expect(out).toEqual(['Post', 'Comment']);
    expect(sorter.cycles).toEqual([]);
  });

  // ── diamond ──────────────────────────────────────────────────────────

  it('orders a diamond dependency', () => {
    // D → B, D → C, B → A, C → A
    const out = names(sorter.sort([bp('D', ['B', 'C']), bp('C', ['A']), bp('B', ['A']), bp('A')]));
    assertBefore('A', 'B', out);
    assertBefore('A', 'C', out);
    assertBefore('B', 'D', out);
    assertBefore('C', 'D', out);
    expect(out[0]).toBe('A');
    expect(out[3]).toBe('D');
    expect(sorter.cycles).toEqual([]);
  });

  // ── mixed independents + chains ──────────────────────────────────────

  it('orders chains while keeping independents in relative order', () => {
    const input = [
      bp('Alpha'),
      bp('Comment', ['Post']),
      bp('Post', ['Blog']),
      bp('Zeta'),
      bp('Blog'),
    ];
    const out = names(sorter.sort(input));
    assertBefore('Blog', 'Post', out);
    assertBefore('Post', 'Comment', out);
    assertBefore('Alpha', 'Zeta', out);
    assertSameModelSet(input, sorter.sort(input));
  });

  // ── references that impose NO ordering ───────────────────────────────

  it('treats a self-reference as neither a dependency nor a cycle', () => {
    const out = names(sorter.sort([bp('Category', ['Category']), bp('Tag')]));
    expect(out).toEqual(['Category', 'Tag']);
    expect(sorter.cycles).toEqual([]);
  });

  it('ignores references to models outside the generation set', () => {
    // Post → Organization (created by rhino install, not in this set).
    const out = names(sorter.sort([bp('Post', ['Organization']), bp('Comment')]));
    expect(out).toEqual(['Post', 'Comment']);
    expect(sorter.cycles).toEqual([]);
  });

  it('does not order on a foreignModel attached to a non-foreignId column', () => {
    const input = [
      bp('Beta', [], [{ type: 'string', foreignModel: 'Alpha' }]),
      bp('Alpha'),
    ];
    expect(names(sorter.sort(input))).toEqual(['Beta', 'Alpha']);
    expect(sorter.cycles).toEqual([]);
  });

  it('counts duplicate FKs to the same parent once', () => {
    const out = names(sorter.sort([bp('Match', ['Team', 'Team']), bp('Team')]));
    expect(out).toEqual(['Team', 'Match']);
    expect(sorter.cycles).toEqual([]);
  });

  // ── cycles ───────────────────────────────────────────────────────────

  it('detects a direct cycle and still returns all models', () => {
    const input = [bp('A', ['B']), bp('B', ['A'])];
    const out = sorter.sort(input);
    assertSameModelSet(input, out);
    expect(out).toHaveLength(2);
    expect(sorter.cycles).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('detects a three-node cycle', () => {
    const input = [bp('A', ['B']), bp('B', ['C']), bp('C', ['A'])];
    assertSameModelSet(input, sorter.sort(input));
    expect(sorter.cycles.length).toBeGreaterThan(0);
  });

  it('keeps a downstream dependent out of the cycle and after it', () => {
    // A ↔ B cycle; C → A depends on the cycle.
    const input = [bp('A', ['B']), bp('B', ['A']), bp('C', ['A'])];
    const out = names(sorter.sort(input));
    assertSameModelSet(input, sorter.sort(input));
    assertBefore('A', 'C', out);
    expect(sorter.cycles).not.toContain('C');
  });

  it('detects two independent cycles', () => {
    const input = [bp('A', ['B']), bp('B', ['A']), bp('X', ['Y']), bp('Y', ['X'])];
    sorter.sort(input);
    expect(sorter.cycles).toEqual(expect.arrayContaining(['A', 'B', 'X', 'Y']));
  });

  // ── determinism ──────────────────────────────────────────────────────

  it('is idempotent', () => {
    const input = [bp('Comment', ['Post']), bp('Post', ['Blog']), bp('Blog'), bp('Tag')];
    const once = sorter.sort(input);
    const twice = sorter.sort(once);
    expect(names(once)).toEqual(names(twice));
  });

  it('resets cycles between runs', () => {
    sorter.sort([bp('A', ['B']), bp('B', ['A'])]);
    expect(sorter.cycles.length).toBeGreaterThan(0);
    sorter.sort([bp('Blog'), bp('Post', ['Blog'])]);
    expect(sorter.cycles).toEqual([]);
  });
});
