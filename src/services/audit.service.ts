import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ModelRegistration } from '../interfaces/rhino-config.interface';

export interface AuditContext {
  user?: any;
  organization?: any;
  ipAddress?: string;
  userAgent?: string;
}

const BASE_AUDIT_EXCLUDE = ['password', 'rememberToken', 'remember_token'];

/**
 * Writes audit log entries. One audit row per CRUD mutation with
 * action ∈ {created, updated, deleted, forceDeleted, restored}.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private delegate() {
    return this.prisma.model('auditLog');
  }

  async log(params: {
    auditableType: string;
    auditableId: any;
    action: 'created' | 'updated' | 'deleted' | 'forceDeleted' | 'restored';
    oldValues?: any;
    newValues?: any;
    ctx?: AuditContext;
    excludeFields?: string[];
  }): Promise<void> {
    const excluded = new Set([...(params.excludeFields ?? []), ...BASE_AUDIT_EXCLUDE]);
    const filterExcluded = (obj: any) => {
      if (!obj) return obj;
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!excluded.has(k)) out[k] = v;
      }
      return out;
    };
    try {
      await this.delegate().create({
        data: {
          auditableType: params.auditableType,
          auditableId: params.auditableId,
          action: params.action,
          oldValues: filterExcluded(params.oldValues),
          newValues: filterExcluded(params.newValues),
          userId: params.ctx?.user?.id ?? null,
          organizationId: params.ctx?.organization?.id ?? null,
          ipAddress: params.ctx?.ipAddress ?? null,
          userAgent: params.ctx?.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `AuditService: failed to write audit entry for ${params.auditableType}#${params.auditableId} (${params.action}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Return the subset of changed fields from a Prisma update.
   * Returns null if no meaningful changes (beyond excluded fields).
   */
  diff(oldRecord: any, newRecord: any, reg: ModelRegistration): { old: any; new: any } | null {
    if (!oldRecord || !newRecord) return null;
    const excluded = new Set([...(reg.auditExclude ?? []), ...BASE_AUDIT_EXCLUDE, 'updatedAt', 'updated_at']);
    const oldOut: any = {};
    const newOut: any = {};
    const keys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);
    for (const k of keys) {
      if (excluded.has(k)) continue;
      const o = oldRecord[k];
      const n = newRecord[k];
      if (JSON.stringify(o) !== JSON.stringify(n)) {
        oldOut[k] = o;
        newOut[k] = n;
      }
    }
    if (Object.keys(newOut).length === 0) return null;
    return { old: oldOut, new: newOut };
  }
}
