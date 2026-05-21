import type { Blueprint, BlueprintColumn, BlueprintRelationship } from '../blueprint-parser';

// ---------------------------------------------------------------------------
// Prisma type mapping
// ---------------------------------------------------------------------------

const BASE_TYPE_MAP: Record<string, string> = {
  string: 'String',
  text: 'String',
  integer: 'Int',
  bigInteger: 'BigInt',
  boolean: 'Boolean',
  date: 'DateTime',
  datetime: 'DateTime',
  timestamp: 'DateTime',
  float: 'Float',
  json: 'Json',
  uuid: 'String',
  foreignId: 'Int',
  // decimal — provider-dependent (see typeFor)
  // enum — handled specially
};

export type PrismaProvider = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'mongodb';

export interface PrismaSchemaGenerateOptions {
  /**
   * Target datasource provider. SQLite has no native Decimal; `decimal`
   * columns map to `Float` for SQLite and `Decimal` elsewhere. Defaults to
   * `postgresql`.
   */
  provider?: PrismaProvider;
  /**
   * Existing `prisma/schema.prisma` content. When provided, any model whose
   * name already appears is SKIPPED — the generator returns an empty string
   * for that model block. Consumer's hand-authored schemas are preserved.
   * (BP-002 — no more duplicate `model Foo { ... }` blocks.)
   */
  existingSchema?: string;
}

// ---------------------------------------------------------------------------
// PrismaSchemaGenerator
// ---------------------------------------------------------------------------

/**
 * Generates a Prisma `model` block (plus any required enum declarations)
 * from a Blueprint.
 *
 * BP-002 corrections:
 *   - Skip generation when the model already exists in `existingSchema`
 *   - Emit proper `@relation(fields, references)` for `foreignId` columns
 *     that name a `foreign_model`
 *   - Switch `decimal` → `Float` on SQLite; keep `Decimal` on other providers
 *   - Honor `has_uuid` for the primary key (already in place via BP-005)
 */
export class PrismaSchemaGenerator {
  generate(blueprint: Blueprint, options: PrismaSchemaGenerateOptions = {}): string {
    const provider: PrismaProvider = options.provider ?? 'postgresql';

    // BP-002: if the model already exists in the consumer's schema, produce
    // NOTHING. This is the safe default — don't duplicate, don't overwrite.
    if (options.existingSchema && modelExistsInSchema(options.existingSchema, blueprint.model)) {
      return '';
    }

    const parts: string[] = [];
    const existing = options.existingSchema ?? '';

    for (const col of blueprint.columns) {
      if (col.type === 'enum' && col.values?.length) {
        const enumName = `${blueprint.model}${pascalCase(col.name)}`;
        // Don't redeclare enums that already exist
        if (!enumExistsInSchema(existing, enumName)) {
          parts.push(this.generateEnum(enumName, col));
        }
      }
    }

    parts.push(this.generateModelBlock(blueprint, provider));
    return parts.join('\n\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private generateEnum(enumName: string, col: BlueprintColumn): string {
    const values = (col.values ?? []).map((v) => `  ${v.toUpperCase()}`).join('\n');
    return `enum ${enumName} {\n${values}\n}`;
  }

  private generateModelBlock(blueprint: Blueprint, provider: PrismaProvider): string {
    const lines: string[] = [];

    // -- id ---------------------------------------------------------------
    if (blueprint.options.has_uuid) {
      lines.push('  id        String   @id @default(uuid())');
    } else {
      lines.push('  id        Int      @id @default(autoincrement())');
    }

    // -- organizationId FK ------------------------------------------------
    if (blueprint.options.belongs_to_organization) {
      lines.push('  organizationId Int');
      lines.push('  organization   Organization @relation(fields: [organizationId], references: [id])');
    }

    // -- user-defined columns --------------------------------------------
    // For `foreignId` columns with a `foreign_model`, emit the FK column
    // immediately followed by the @relation field. Dedupe the relation fields
    // emitted by `relationships:` so we don't generate both.
    const fkColumnsWithRelation = new Set<string>();
    for (const col of blueprint.columns) {
      lines.push(this.generateField(blueprint.model, col, provider));
      if (col.type === 'foreignId' && col.foreignModel) {
        fkColumnsWithRelation.add(col.name);
        const relName = stripIdSuffix(col.name); // projectId → project
        const modelRef = col.nullable ? `${col.foreignModel}?` : col.foreignModel;
        lines.push(
          `  ${relName.padEnd(12)} ${modelRef} @relation(fields: [${col.name}], references: [id])`,
        );
      }
    }

    // -- relationships ----------------------------------------------------
    for (const rel of blueprint.relationships) {
      this.generateRelationship(rel, fkColumnsWithRelation, lines);
    }

    // -- timestamps -------------------------------------------------------
    lines.push('  createdAt DateTime @default(now())');
    lines.push('  updatedAt DateTime @updatedAt');

    if (blueprint.options.soft_deletes) {
      lines.push('  deletedAt DateTime?');
    }

    // -- @@map ------------------------------------------------------------
    lines.push('');
    lines.push(`  @@map("${blueprint.table}")`);

    return `model ${blueprint.model} {\n${lines.join('\n')}\n}`;
  }

  private generateRelationship(
    rel: BlueprintRelationship,
    alreadyEmitted: Set<string>,
    lines: string[],
  ): void {
    if (rel.type === 'belongsTo') {
      // Skip when we already emitted this FK + @relation from a `foreignId`
      // column (avoids duplicate relation fields).
      const fkField = `${rel.name}Id`;
      if (alreadyEmitted.has(fkField)) return;

      lines.push(`  ${fkField.padEnd(12)} Int`);
      lines.push(
        `  ${rel.name.padEnd(12)} ${rel.model} @relation(fields: [${fkField}], references: [id])`,
      );
    } else if (rel.type === 'hasMany') {
      lines.push(`  ${rel.name.padEnd(12)} ${rel.model}[]`);
    } else if (rel.type === 'hasOne') {
      lines.push(`  ${rel.name.padEnd(12)} ${rel.model}?`);
    }
    // belongsToMany: join-table generation is deliberately out of scope;
    // consumers declare the pivot model themselves.
  }

  private generateField(modelName: string, col: BlueprintColumn, provider: PrismaProvider): string {
    let prismaType: string;
    let modifiers = '';

    if (col.type === 'enum') {
      prismaType = `${modelName}${pascalCase(col.name)}`;
    } else if (col.type === 'decimal') {
      prismaType = provider === 'sqlite' ? 'Float' : 'Decimal';
    } else {
      prismaType = BASE_TYPE_MAP[col.type] ?? 'String';
    }

    if (col.nullable) prismaType += '?';

    // @default
    if (col.default !== null && col.default !== undefined) {
      if (col.type === 'boolean') {
        modifiers += ` @default(${col.default})`;
      } else if (col.type === 'enum') {
        modifiers += ` @default(${String(col.default).toUpperCase()})`;
      } else if (typeof col.default === 'string') {
        modifiers += ` @default("${col.default}")`;
      } else {
        modifiers += ` @default(${col.default})`;
      }
    }

    // @unique
    if (col.unique) modifiers += ' @unique';

    const paddedName = col.name.padEnd(12);
    const paddedType = prismaType.padEnd(10);

    return `  ${paddedName} ${paddedType}${modifiers}`;
  }
}

// ---------------------------------------------------------------------------
// Schema introspection helpers (tiny — no full AST needed)
// ---------------------------------------------------------------------------

/**
 * Return true when the given schema text declares `model <name> { ... }`.
 * Matches the canonical Prisma syntax; doesn't try to parse comments or
 * unusual whitespace — just a pragmatic check for "is this name taken".
 */
export function modelExistsInSchema(schema: string, modelName: string): boolean {
  const re = new RegExp(`^\\s*model\\s+${escapeRegex(modelName)}\\s*\\{`, 'm');
  return re.test(schema);
}

/** Same, for top-level `enum <Name> { ... }` declarations. */
export function enumExistsInSchema(schema: string, enumName: string): boolean {
  const re = new RegExp(`^\\s*enum\\s+${escapeRegex(enumName)}\\s*\\{`, 'm');
  return re.test(schema);
}

function pascalCase(str: string): string {
  return str
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function stripIdSuffix(name: string): string {
  return name.endsWith('Id') ? name.slice(0, -2) : name;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
