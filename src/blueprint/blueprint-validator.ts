import type { Blueprint, BlueprintColumn, BlueprintPermission } from './blueprint-parser';

// ---------------------------------------------------------------------------
// Valid values
// ---------------------------------------------------------------------------

const VALID_COLUMN_TYPES = [
  'string', 'text', 'integer', 'bigInteger', 'boolean',
  'date', 'datetime', 'timestamp', 'decimal', 'float',
  'json', 'uuid', 'foreignId', 'enum',
] as const;

const VALID_ACTIONS = [
  'index', 'show', 'store', 'update', 'destroy',
  'trashed', 'restore', 'forceDelete',
] as const;

const VALID_RELATIONSHIP_TYPES = ['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'] as const;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class BlueprintValidator {
  /**
   * Validate a parsed Blueprint. Returns errors and warnings.
   *
   * @param blueprint  Parsed blueprint from BlueprintParser.parseModel()
   * @param validRoles Optional array of known role slugs — enables stricter role checks
   */
  validate(blueprint: Blueprint, validRoles: string[] = []): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // -- model name ----------------------------------------------------------
    if (!blueprint.model) {
      errors.push('Model name is required.');
    } else if (!/^[A-Z][a-zA-Z0-9]*$/.test(blueprint.model)) {
      errors.push(
        `Model name '${blueprint.model}' must be PascalCase (e.g., 'Post', 'BlogPost').`,
      );
    }

    // -- slug ----------------------------------------------------------------
    if (blueprint.slug && !/^[a-z][a-z0-9_-]*$/.test(blueprint.slug)) {
      errors.push(`Slug '${blueprint.slug}' must be lowercase alphanumeric with hyphens/underscores.`);
    }

    // -- columns -------------------------------------------------------------
    const colErrors = this.validateColumns(blueprint.columns ?? []);
    errors.push(...colErrors);

    // -- permissions ---------------------------------------------------------
    const columnNames = (blueprint.columns ?? []).map((c) => c.name);
    const permResult = this.validatePermissions(
      blueprint.permissions ?? {},
      validRoles,
      columnNames,
    );
    errors.push(...permResult.errors);
    warnings.push(...permResult.warnings);

    // -- options -------------------------------------------------------------
    const optErrors = this.validateOptions(blueprint.options);
    errors.push(...optErrors);

    // -- relationships -------------------------------------------------------
    const relErrors = this.validateRelationships(blueprint.relationships ?? []);
    errors.push(...relErrors);

    return { valid: errors.length === 0, errors, warnings };
  }

  // -------------------------------------------------------------------------
  // Section validators
  // -------------------------------------------------------------------------

  private validateColumns(columns: BlueprintColumn[]): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const col of columns) {
      if (!col.name) {
        errors.push('Column name cannot be empty.');
        continue;
      }

      if (seen.has(col.name)) {
        errors.push(`Duplicate column name: '${col.name}'.`);
      }
      seen.add(col.name);

      if (!(VALID_COLUMN_TYPES as readonly string[]).includes(col.type)) {
        errors.push(
          `Column '${col.name}' has invalid type '${col.type}'. Valid types: ${VALID_COLUMN_TYPES.join(', ')}.`,
        );
      }

      if (col.type === 'foreignId' && !col.foreignModel) {
        errors.push(`Column '${col.name}' has type foreignId but is missing 'foreign_model'.`);
      }

      if (col.type === 'enum' && (!col.values || col.values.length === 0)) {
        errors.push(`Column '${col.name}' has type enum but is missing 'values'.`);
      }
    }

    return errors;
  }

  private validatePermissions(
    permissions: Record<string, BlueprintPermission>,
    validRoles: string[],
    columnNames: string[],
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [role, def] of Object.entries(permissions)) {
      // Validate role exists (if roles list provided)
      if (validRoles.length > 0 && !validRoles.includes(role)) {
        errors.push(`Permission defined for unknown role '${role}'. Define it in your roles list first.`);
      }

      // Validate actions
      for (const action of def.actions ?? []) {
        if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
          errors.push(
            `Role '${role}' has invalid action '${action}'. Valid actions: ${VALID_ACTIONS.join(', ')}.`,
          );
        }
      }

      // Warn about unknown fields in show_fields
      const showFields = def.show_fields ?? [];
      if (showFields[0] !== '*' && columnNames.length > 0) {
        for (const field of showFields) {
          if (field !== 'id' && !columnNames.includes(field)) {
            warnings.push(`Role '${role}' references unknown field '${field}' in show_fields.`);
          }
        }
      }

      // Conflicts: field in both show_fields and hidden_fields
      const hiddenFields = def.hidden_fields ?? [];
      if (showFields[0] !== '*' && hiddenFields.length > 0) {
        const conflicts = showFields.filter((f) => hiddenFields.includes(f));
        if (conflicts.length > 0) {
          warnings.push(
            `Role '${role}' has fields in both show_fields and hidden_fields: ${conflicts.join(', ')}.`,
          );
        }
      }

      // Warn if create_fields defined without store action
      const createFields = def.create_fields;
      const hasCreateFields =
        createFields &&
        !(Array.isArray(createFields) && createFields[0] === '*') &&
        (Array.isArray(createFields) ? createFields.length > 0 : Object.keys(createFields).length > 0);

      if (hasCreateFields && !def.actions.includes('store')) {
        warnings.push(`Role '${role}' has create_fields but no 'store' action.`);
      }

      // Warn if update_fields defined without update action
      const updateFields = def.update_fields;
      const hasUpdateFields =
        updateFields &&
        !(Array.isArray(updateFields) && updateFields[0] === '*') &&
        (Array.isArray(updateFields) ? updateFields.length > 0 : Object.keys(updateFields).length > 0);

      if (hasUpdateFields && !def.actions.includes('update')) {
        warnings.push(`Role '${role}' has update_fields but no 'update' action.`);
      }
    }

    return { errors, warnings };
  }

  private validateOptions(options: Blueprint['options']): string[] {
    const errors: string[] = [];
    if (!options) return errors;

    for (const action of options.except_actions ?? []) {
      if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
        errors.push(`Invalid except_action: '${action}'.`);
      }
    }

    return errors;
  }

  private validateRelationships(relationships: Blueprint['relationships']): string[] {
    const errors: string[] = [];

    for (const rel of relationships) {
      if (!rel.type) {
        errors.push('Relationship is missing type.');
        continue;
      }

      if (!(VALID_RELATIONSHIP_TYPES as readonly string[]).includes(rel.type)) {
        errors.push(
          `Invalid relationship type '${rel.type}'. Valid: ${VALID_RELATIONSHIP_TYPES.join(', ')}.`,
        );
      }

      if (!rel.model) {
        errors.push(`Relationship '${rel.name}' of type '${rel.type}' is missing model.`);
      }
    }

    return errors;
  }
}
