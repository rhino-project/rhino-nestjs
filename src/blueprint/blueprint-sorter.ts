/**
 * Orders blueprints so that a referenced model is processed before any model
 * whose foreign keys point at it (parents before children).
 *
 * Foreign keys are taken from `foreignId` columns that carry a `foreignModel`
 * mapping to another model in the same generation set. References that impose no
 * ordering are ignored:
 *   - self-references (a model's FK to its own table),
 *   - references to models NOT in this set (e.g. `Organization`/`User`, created
 *     by `rhino install`, not the blueprint run).
 *
 * Prisma resolves relations regardless of model declaration order, but the
 * processing order still matters for order-sensitive output (notably seeders: a
 * child row referencing a parent must be inserted after it) and for parity with
 * the Laravel/Rails stacks, where migration timestamps follow this order.
 *
 * Uses Kahn's algorithm with a stable tie-break: among models with no remaining
 * unmet dependency, the one earliest in the input order wins. The input is
 * already alphabetical, so the output stays alphabetical wherever relationships
 * don't force a reorder.
 *
 * A circular FK dependency (A → B → A) has no linear order; such models are
 * emitted in a deterministic best-effort order and reported via {@link cycles}
 * so the caller can warn (one side should be a nullable / deferred FK).
 */
export interface SortableColumn {
  type?: string;
  foreignModel?: string | null;
}

export interface SortableBlueprint {
  model: string;
  columns?: SortableColumn[];
}

export class BlueprintSorter {
  private _cycles: string[] = [];

  /**
   * Model names involved in a circular foreign-key dependency during the last
   * {@link sort} (empty when the dependency graph is acyclic).
   */
  get cycles(): string[] {
    return this._cycles;
  }

  /** Re-order blueprints into a valid sequence (parents first). */
  sort<T extends SortableBlueprint>(blueprints: T[]): T[] {
    this._cycles = [];
    if (blueprints.length < 2) {
      return [...blueprints];
    }

    const byModel = new Map<string, T>();
    for (const bp of blueprints) {
      if (bp.model && !byModel.has(bp.model)) {
        byModel.set(bp.model, bp);
      }
    }

    const dependents = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    for (const m of byModel.keys()) {
      dependents.set(m, []);
      indegree.set(m, 0);
    }

    for (const [model, bp] of byModel) {
      const seen = new Set<string>();
      for (const ref of this.dependencyModels(bp)) {
        if (ref === model || !byModel.has(ref) || seen.has(ref)) {
          continue;
        }
        seen.add(ref);
        dependents.get(ref)!.push(model);
        indegree.set(model, (indegree.get(model) ?? 0) + 1);
      }
    }

    const inputOrder = [...byModel.keys()];

    // Record the models that actually participate in a cycle (reachable from
    // themselves), in input order, so the caller can warn about the full cycle.
    for (const model of inputOrder) {
      if (this.reachableFromSelf(model, dependents)) {
        this._cycles.push(model);
      }
    }

    const ordered: T[] = [];
    const resolved = new Set<string>();
    while (ordered.length < byModel.size) {
      // Earliest-input model with all dependencies already emitted...
      let pick = inputOrder.find((m) => !resolved.has(m) && indegree.get(m) === 0);
      // ...or, when a cycle blocks the graph, the earliest unresolved model
      // (deterministic cycle-break; the cycle itself is reported via cycles).
      if (pick === undefined) {
        pick = inputOrder.find((m) => !resolved.has(m));
      }
      const picked = pick as string;

      ordered.push(byModel.get(picked)!);
      resolved.add(picked);
      for (const child of dependents.get(picked)!) {
        indegree.set(child, (indegree.get(child) ?? 0) - 1);
      }
    }

    return ordered;
  }

  /**
   * Whether `start` can reach itself by following dependency edges — i.e. it
   * participates in a circular foreign-key dependency. `adj` maps a model to the
   * models that reference it (its dependents).
   */
  private reachableFromSelf(start: string, adj: Map<string, string[]>): boolean {
    const stack = [...(adj.get(start) ?? [])];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === start) {
        return true;
      }
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      for (const next of adj.get(node) ?? []) {
        stack.push(next);
      }
    }
    return false;
  }

  /**
   * The model names this blueprint's foreign keys point at, taken from its
   * `foreignId` columns that carry a `foreignModel`.
   */
  private dependencyModels(bp: SortableBlueprint): string[] {
    const refs: string[] = [];
    for (const col of bp.columns ?? []) {
      if (col.type === 'foreignId' && col.foreignModel) {
        refs.push(col.foreignModel);
      }
    }
    return refs;
  }
}
