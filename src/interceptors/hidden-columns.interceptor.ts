import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RhinoConfigService } from '../rhino.config';
import { SerializerService } from '../services/serializer.service';

/**
 * Applies serializer filtering (base hidden, additional hidden, policy-driven
 * whitelist/blacklist, computed attributes) when a non-serialized record is
 * returned from a handler.
 *
 * Order with ResponseInterceptor: register this interceptor BEFORE
 * ResponseInterceptor in the provider chain.
 */
@Injectable()
export class HiddenColumnsInterceptor implements NestInterceptor {
  constructor(
    private readonly config: RhinoConfigService,
    private readonly serializer: SerializerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const modelSlug = req.params?.modelSlug;
    const reg = modelSlug ? this.config.model(modelSlug) : null;
    if (!reg) return next.handle();
    // BP-007: pass {user, organization} so role-keyed policies resolve properly.
    const ctx = { user: req.user, organization: req.organization };

    return next.handle().pipe(
      map((body: any) => {
        if (!body) return body;
        // Preserve paginated envelope shape if present
        if (body.__rhinoPaginated) {
          return {
            ...body,
            items: this.serializer.serializeMany(body.items, reg, ctx),
          };
        }
        if (body.data && Array.isArray(body.data)) {
          return { ...body, data: this.serializer.serializeMany(body.data, reg, ctx) };
        }
        if (Array.isArray(body)) {
          return this.serializer.serializeMany(body, reg, ctx);
        }
        return this.serializer.serializeOne(body, reg, ctx);
      }),
    );
  }
}
