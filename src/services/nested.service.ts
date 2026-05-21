import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RhinoConfigService } from '../rhino.config';
import { ValidationService } from './validation.service';

export interface NestedOperation {
  model: string;
  action: 'create' | 'update' | 'delete';
  id?: number | string;
  data?: Record<string, any>;
}

export interface NestedExecContext {
  user?: any;
  organization?: any;
}

export interface NestedResult {
  index: number;
  model: string;
  action: 'create' | 'update' | 'delete';
  id: any;
  data: any;
}

const REF_PATTERN = /^\$(\d+)\.([\w.]+)$/;

/**
 * Executes a batch of nested CRUD operations atomically.
 * Supports `$N.field` references to prior operations' return values.
 */
@Injectable()
export class NestedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RhinoConfigService,
    private readonly validation: ValidationService,
  ) {}

  async execute(operations: NestedOperation[], ctx: NestedExecContext): Promise<NestedResult[]> {
    const maxOps = this.config.nestedConfig().maxOperations;
    const allowed = this.config.nestedConfig().allowedModels;
    if (operations.length === 0) {
      throw new BadRequestException('No operations provided');
    }
    if (operations.length > maxOps) {
      throw new BadRequestException(`Too many operations (max ${maxOps})`);
    }

    for (const op of operations) {
      if (!op.model || !op.action) {
        throw new BadRequestException('Each operation must have model and action');
      }
      if (!['create', 'update', 'delete'].includes(op.action)) {
        throw new BadRequestException(`Unsupported action: ${op.action}`);
      }
      if ((op.action === 'update' || op.action === 'delete') && op.id == null) {
        throw new BadRequestException(`Action ${op.action} requires an id`);
      }
      if (!this.config.hasModel(op.model)) {
        throw new BadRequestException(`Unknown model: ${op.model}`);
      }
      if (allowed && !allowed.includes(op.model)) {
        throw new BadRequestException(`Model not allowed for nested: ${op.model}`);
      }
    }

    return this.prisma.$transaction(async (tx: any) => {
      const results: NestedResult[] = [];
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const reg = this.config.model(op.model)!;
        const delegate = tx[this.camelize(reg.model)] ?? tx[reg.model];
        if (!delegate) {
          throw new BadRequestException(`Prisma delegate missing: ${reg.model}`);
        }

        if (op.action === 'delete') {
          const where: Record<string, any> = { id: op.id };
          if (reg.belongsToOrganization && ctx.organization) {
            where.organizationId = ctx.organization.id;
          }
          if (reg.softDeletes) {
            const res = await delegate.updateMany({ where, data: { deletedAt: new Date() } });
            if (res.count === 0) {
              throw new BadRequestException({
                message: 'Record not found or cross-tenant',
                operationIndex: i,
              });
            }
          } else {
            const res = await delegate.deleteMany({ where });
            if (res.count === 0) {
              throw new BadRequestException({
                message: 'Record not found or cross-tenant',
                operationIndex: i,
              });
            }
          }
          results.push({ index: i, model: op.model, action: 'delete', id: op.id, data: null });
          continue;
        }

        const resolvedData = this.resolveReferences(op.data ?? {}, results);
        const validationResult = this.validation.validateForAction(resolvedData, reg, {
          action: op.action === 'create' ? 'store' : 'update',
          user: ctx.user,
          organization: ctx.organization,
        });
        if (!validationResult.valid) {
          throw new BadRequestException({
            message: 'Validation failed',
            operationIndex: i,
            errors: validationResult.errors,
          });
        }
        const payload = validationResult.data!;
        if (reg.belongsToOrganization && ctx.organization && op.action === 'create') {
          (payload as any).organizationId = ctx.organization.id;
        }

        if (op.action === 'create') {
          const record = await delegate.create({ data: payload });
          results.push({ index: i, model: op.model, action: 'create', id: record.id, data: record });
        } else {
          const where: Record<string, any> = { id: op.id };
          if (reg.belongsToOrganization && ctx.organization) {
            where.organizationId = ctx.organization.id;
          }
          const res = await delegate.updateMany({ where, data: payload });
          if (res.count === 0) {
            throw new BadRequestException({
              message: 'Record not found or cross-tenant',
              operationIndex: i,
            });
          }
          const record = await delegate.findFirst({ where });
          results.push({ index: i, model: op.model, action: 'update', id: record.id, data: record });
        }
      }
      return results;
    });
  }

  private camelize(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  resolveReferences(data: Record<string, any>, results: NestedResult[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') {
        const match = v.match(REF_PATTERN);
        if (match) {
          const idx = parseInt(match[1], 10);
          const path = match[2];
          const prior = results[idx]?.data;
          out[k] = prior ? this.readPath(prior, path) : undefined;
          continue;
        }
      }
      out[k] = v;
    }
    return out;
  }

  private readPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, p) => (acc == null ? acc : acc[p]), obj);
  }
}
