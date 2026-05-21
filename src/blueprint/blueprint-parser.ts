import * as fs from 'fs';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueprintOptions {
  belongs_to_organization: boolean;
  soft_deletes: boolean;
  audit_trail: boolean;
  /** When true, primary key is `String @default(uuid())` instead of `Int @default(autoincrement())`. */
  has_uuid: boolean;
  /**
   * BP-004: legacy single-hop owner. Kept for backwards compat; prefer
   * `owner_chain` for multi-hop indirect tenancy.
   */
  owner: string | null;
  /**
   * BP-004: dot-notated chain from this model to its tenant-scoped ancestor.
   * Example for Comment → Task → Project → Organization:
   *   owner_chain: task.project
   * The last segment must name a model with `belongs_to_organization: true`.
   */
  owner_chain: string | null;
  except_actions: string[];
  pagination: boolean;
  per_page: number;
}

/**
 * BP-004: declares an FK column that must resolve to a record inside the
 * current organization. Consumed by ValidationService.verifyTenantFks.
 */
export interface BlueprintFkConstraint {
  field: string;
  model: string;
}

export interface BlueprintColumn {
  name: string;
  type: string;
  nullable: boolean;
  unique: boolean;
  index: boolean;
  default: unknown;
  filterable: boolean;
  sortable: boolean;
  searchable: boolean;
  precision: number | null;
  scale: number | null;
  foreignModel: string | null;
  /** Enum values — only meaningful when type === 'enum' */
  values?: string[];
}

export interface BlueprintPermission {
  actions: string[];
  show_fields: string[];
  create_fields: Record<string, string> | string[];
  update_fields: Record<string, string> | string[];
  hidden_fields: string[];
}

export interface BlueprintRelationship {
  name: string;
  type: string;
  model: string;
}

export interface Blueprint {
  model: string;
  slug: string;
  table: string;
  options: BlueprintOptions;
  columns: BlueprintColumn[];
  relationships: BlueprintRelationship[];
  permissions: Record<string, BlueprintPermission>;
  /** BP-004: explicit FK → model constraints for cross-tenant validation. */
  fk_constraints?: BlueprintFkConstraint[];
  source_file: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class BlueprintParser {
  /**
   * Parse a model blueprint YAML file into a normalised Blueprint object.
   * Throws on missing/invalid structure.
   */
  parseModel(filePath: string): Blueprint {
    const raw = this.loadYaml(filePath);

    if (!raw['model']) {
      throw new Error(`Invalid blueprint file: missing 'model' key in ${filePath}`);
    }

    const modelName = String(raw['model']);
    const slug: string = (raw['slug'] as string | undefined) ?? this.toSlug(modelName);
    const tableName: string = (raw['table'] as string | undefined) ?? slug;

    return {
      model: modelName,
      slug,
      table: tableName,
      options: this.normalizeOptions(raw['options'] ?? {}),
      columns: this.normalizeColumns(raw['columns'] ?? {}),
      relationships: this.normalizeRelationships(raw['relationships'] ?? {}),
      permissions: this.normalizePermissions(raw['permissions'] ?? {}),
      fk_constraints: this.normalizeFkConstraints(raw['fk_constraints'] ?? []),
      source_file: require('path').basename(filePath),
    };
  }

  /**
   * Compute SHA-256 hash of a file's content for manifest tracking.
   */
  computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private loadYaml(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Blueprint file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (!content || content.trim() === '') {
      throw new Error(`Blueprint file is empty: ${filePath}`);
    }

    let data: unknown;
    try {
      data = yaml.load(content);
    } catch (err: any) {
      throw new Error(`Invalid YAML in ${filePath}: ${err.message}`);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`YAML file must contain an associative mapping: ${filePath}`);
    }

    return data as Record<string, unknown>;
  }

  private normalizeOptions(raw: unknown): BlueprintOptions {
    const opts = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    return {
      belongs_to_organization: Boolean(opts['belongs_to_organization'] ?? false),
      soft_deletes: Boolean(opts['soft_deletes'] ?? true),
      audit_trail: Boolean(opts['audit_trail'] ?? false),
      has_uuid: Boolean(opts['has_uuid'] ?? false),
      owner: (opts['owner'] as string) ?? null,
      owner_chain: this.normalizeOwnerChain(opts['owner_chain']),
      except_actions: Array.isArray(opts['except_actions']) ? (opts['except_actions'] as string[]) : [],
      pagination: Boolean(opts['pagination'] ?? false),
      per_page: Number(opts['per_page'] ?? 25),
    };
  }

  /**
   * Normalize various `owner_chain` YAML shapes into a single dot-notated
   * string or null. Supports:
   *
   *   owner_chain: task.project          → 'task.project'
   *   owner_chain: [task, project]       → 'task.project'
   *   owner_chain: null / absent          → null
   *   owner_chain: ''                     → null
   */
  private normalizeOwnerChain(raw: unknown): string | null {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(raw)) {
      const parts = raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
      return parts.length > 0 ? parts.join('.') : null;
    }
    return null;
  }

  /**
   * Normalize the `fk_constraints:` YAML section into a flat array of
   * { field, model } tuples. Accepts two shapes:
   *
   *   fk_constraints:
   *     - field: projectId
   *       model: project
   *     - field: assignedTo
   *       model: user
   *
   *   fk_constraints:
   *     projectId: project       ← object shorthand
   *     assignedTo: user
   */
  private normalizeFkConstraints(raw: unknown): BlueprintFkConstraint[] {
    if (Array.isArray(raw)) {
      const out: BlueprintFkConstraint[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const field = (e['field'] as string) ?? '';
        const model = (e['model'] as string) ?? '';
        if (field && model) out.push({ field, model });
      }
      return out;
    }
    if (raw && typeof raw === 'object') {
      const out: BlueprintFkConstraint[] = [];
      for (const [field, model] of Object.entries(raw as Record<string, unknown>)) {
        if (field && typeof model === 'string' && model.length > 0) {
          out.push({ field, model });
        }
      }
      return out;
    }
    return [];
  }

  private normalizeColumns(raw: unknown): BlueprintColumn[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

    const columns: BlueprintColumn[] = [];
    for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
      // Short syntax: "title: string"
      const def: Record<string, unknown> =
        typeof definition === 'string'
          ? { type: definition }
          : (definition as Record<string, unknown>) ?? {};

      columns.push({
        name,
        type: String(def['type'] ?? 'string'),
        nullable: Boolean(def['nullable'] ?? false),
        unique: Boolean(def['unique'] ?? false),
        index: Boolean(def['index'] ?? false),
        default: def['default'] ?? null,
        filterable: Boolean(def['filterable'] ?? false),
        sortable: Boolean(def['sortable'] ?? false),
        searchable: Boolean(def['searchable'] ?? false),
        precision: def['precision'] != null ? Number(def['precision']) : null,
        scale: def['scale'] != null ? Number(def['scale']) : null,
        foreignModel: (def['foreign_model'] as string) ?? null,
        values: Array.isArray(def['values']) ? (def['values'] as string[]) : undefined,
      });
    }
    return columns;
  }

  private normalizeRelationships(raw: unknown): BlueprintRelationship[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

    const rels: BlueprintRelationship[] = [];
    for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
      const def = (definition ?? {}) as Record<string, unknown>;
      rels.push({
        name,
        type: String(def['type'] ?? 'belongsTo'),
        model: String(def['model'] ?? ''),
      });
    }
    return rels;
  }

  private normalizePermissions(raw: unknown): Record<string, BlueprintPermission> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const result: Record<string, BlueprintPermission> = {};
    for (const [role, definition] of Object.entries(raw as Record<string, unknown>)) {
      const def = (definition ?? {}) as Record<string, unknown>;

      // actions: ["*"] → ['index','show','store','update','destroy'] or keep as-is
      const rawActions = Array.isArray(def['actions']) ? (def['actions'] as string[]) : [];
      const actions: string[] =
        rawActions.includes('*')
          ? ['index', 'show', 'store', 'update', 'destroy', 'trashed', 'restore', 'forceDelete']
          : rawActions;

      result[role] = {
        actions,
        show_fields: this.normalizeFieldList(def['show_fields'] ?? '*'),
        create_fields: this.normalizeFieldMap(def['create_fields'] ?? {}),
        update_fields: this.normalizeFieldMap(def['update_fields'] ?? {}),
        hidden_fields: Array.isArray(def['hidden_fields']) ? (def['hidden_fields'] as string[]) : [],
      };
    }
    return result;
  }

  /**
   * Normalize show_fields: '*' → ['*'], array → array as-is.
   */
  private normalizeFieldList(fields: unknown): string[] {
    if (fields === '*') return ['*'];
    if (Array.isArray(fields)) return fields as string[];
    if (typeof fields === 'string') return [fields];
    return [];
  }

  /**
   * Normalize create_fields / update_fields.
   * These can be either:
   *   { title: required, content: nullable } (object)
   *   [title, content]                       (array)
   *   '*'                                    (wildcard string)
   * We keep the object form as-is (a Record<string, string>) and convert
   * arrays/wildcards to the same shape for uniform downstream handling.
   */
  private normalizeFieldMap(fields: unknown): Record<string, string> | string[] {
    if (fields === '*') return ['*'];
    if (Array.isArray(fields)) return fields as string[];
    if (fields && typeof fields === 'object') return fields as Record<string, string>;
    return {};
  }

  /**
   * Convert PascalCase model name to plural snake_case slug.
   * e.g. BlogPost → blog_posts
   */
  private toSlug(model: string): string {
    const snake = model.replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`));
    // naive plural: append s (good enough for generator context)
    return snake.endsWith('s') ? snake : `${snake}s`;
  }
}
