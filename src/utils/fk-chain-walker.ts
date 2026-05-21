/**
 * Walk a Prisma model's belongsTo relationships to find the shortest path to
 * an organization-scoped ancestor. Used to scope `exists:` validation rules
 * in tenant contexts (direct + indirect FK chain).
 *
 * The walker is schema-agnostic: caller supplies a `getRelations(model)` fn
 * returning the model's outgoing FK references. Returns `null` if no chain
 * to the organization exists.
 */
export interface FkRelation {
  /** Local column holding the foreign key (e.g., `projectId`). */
  localColumn: string;
  /** Target model name (e.g., `project`). */
  foreignModel: string;
  /** Target model's PK column (e.g., `id`). */
  foreignColumn: string;
}

export interface FkChainStep extends FkRelation {
  /** True when the foreign model has a direct `organizationId` column. */
  leadsToOrg?: boolean;
}

export interface WalkOptions {
  /** Maximum chain depth (default 5). */
  maxDepth?: number;
  /** Function resolving a model's outgoing FK relations. */
  getRelations: (model: string) => FkRelation[];
  /** Function telling whether a model has a direct `organizationId` column. */
  hasOrganizationId: (model: string) => boolean;
}

export function findOrganizationFkChain(
  model: string,
  opts: WalkOptions,
): FkChainStep[] | null {
  const maxDepth = opts.maxDepth ?? 5;
  return walk(model, maxDepth, new Set<string>(), opts);
}

function walk(
  model: string,
  depth: number,
  visited: Set<string>,
  opts: WalkOptions,
): FkChainStep[] | null {
  if (depth <= 0 || visited.has(model)) return null;
  visited.add(model);
  const relations = opts.getRelations(model) ?? [];
  for (const rel of relations) {
    if (opts.hasOrganizationId(rel.foreignModel)) {
      return [{ ...rel, leadsToOrg: true }];
    }
    const deeper = walk(rel.foreignModel, depth - 1, new Set(visited), opts);
    if (deeper) return [{ ...rel }, ...deeper];
  }
  return null;
}
