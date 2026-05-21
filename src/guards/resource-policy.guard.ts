import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { RhinoConfigService } from '../rhino.config';
import { ResourcePolicy } from '../policies/resource-policy';
import { userHasPermission } from '../utils/permission-matcher';
import { RhinoException } from '../errors/rhino-exception';
import type { RhinoRequest } from '../interfaces/rhino-request.interface';

const METHOD_ACTIONS: Record<string, string> = {
  GET_list: 'index',
  GET_one: 'show',
  POST: 'store',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'destroy',
};

/**
 * Runs the model's ResourcePolicy (or convention-based default)
 * to authorize the current request. Action derived from HTTP verb & route.
 */
@Injectable()
export class ResourcePolicyGuard implements CanActivate {
  constructor(private readonly config: RhinoConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RhinoRequest>();
    const modelSlug: string = req.params?.modelSlug ?? (req.params as any)?.model;
    if (!modelSlug) return true; // non-model route — other guards handle it

    const reg = this.config.model(modelSlug);
    if (!reg) throw RhinoException.unknownResource(modelSlug);

    const action = this.resolveAction(req);
    const user = req.user;
    const org = req.organization;

    const PolicyClass = reg.policy;
    const policy = PolicyClass ? new PolicyClass() : new ResourcePolicy();
    policy.resourceSlug = modelSlug;

    let allowed = false;
    switch (action) {
      case 'index':
        allowed = policy.viewAny(user, org);
        break;
      case 'show':
        allowed = policy.view(user, null, org);
        break;
      case 'store':
        allowed = policy.create(user, org);
        break;
      case 'update':
        allowed = policy.update(user, null, org);
        break;
      case 'destroy':
        allowed = policy.delete(user, null, org);
        break;
      case 'trashed':
        allowed = policy.viewTrashed(user, org);
        break;
      case 'restore':
        allowed = policy.restore(user, null, org);
        break;
      case 'forceDelete':
        allowed = policy.forceDelete(user, null, org);
        break;
      default:
        allowed = userHasPermission(user, `${modelSlug}.${action}`, org);
    }

    if (!allowed) throw RhinoException.forbidden();
    req.__action = action;
    return true;
  }

  private resolveAction(req: any): string {
    const method = req.method as string;
    const path = (req.url ?? req.originalUrl ?? '') as string;
    const hasId = req.params?.id != null;
    const parts = path.split('?')[0].split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (method === 'GET' && last === 'trashed') return 'trashed';
    if (method === 'POST' && last === 'restore') return 'restore';
    if (method === 'DELETE' && (last === 'force-delete' || last === 'force')) return 'forceDelete';
    if (method === 'GET') return hasId ? 'show' : 'index';
    if (method === 'POST') return 'store';
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'destroy';
    return 'unknown';
  }
}
