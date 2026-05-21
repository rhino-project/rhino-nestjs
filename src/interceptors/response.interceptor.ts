import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginatedShape {
  __rhinoPaginated: true;
  items: any[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export function paginated(items: any[], total: number, page: number, perPage: number): PaginatedShape {
  return {
    __rhinoPaginated: true,
    items,
    total,
    page,
    perPage,
    lastPage: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * Response envelope interceptor. Two output modes:
 *   - `paginated()` result  → `{data: [...]}` + X-Current-Page/X-Last-Page/X-Per-Page/X-Total headers
 *   - anything else         → pass-through (single record, 204, etc.)
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((body) => {
        if (body && body.__rhinoPaginated) {
          res.setHeader('X-Current-Page', body.page);
          res.setHeader('X-Last-Page', body.lastPage);
          res.setHeader('X-Per-Page', body.perPage);
          res.setHeader('X-Total', body.total);
          return { data: body.items };
        }
        return body;
      }),
    );
  }
}
