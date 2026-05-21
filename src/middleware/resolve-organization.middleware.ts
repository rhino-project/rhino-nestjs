import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { OrganizationService } from '../services/organization.service';

/**
 * Resolves the `:organization` route parameter and attaches the org
 * to `req.organization`. Ensures the authenticated user belongs to it.
 */
@Injectable()
export class ResolveOrganizationMiddleware implements NestMiddleware {
  constructor(private readonly orgService: OrganizationService) {}

  async use(req: Request & { user?: any; organization?: any }, _res: Response, next: NextFunction) {
    const identifier = (req.params as any).organization ?? (req.params as any).org;
    if (!identifier) return next();
    const org = await this.orgService.resolve(identifier, req.user);
    req.organization = org;
    next();
  }
}
