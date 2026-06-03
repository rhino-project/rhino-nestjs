import { INestApplication } from '@nestjs/common';
import { RhinoConfigService } from '../rhino.config';

export interface RegisterRoutesOptions {
  /** Global prefix for all routes (default: "api"). */
  prefix?: string;
  /** Apply the authentication guard globally. Set `false` to skip. */
  enableAuth?: boolean;
}

/**
 * Utility helper invoked during `main.ts` bootstrap to wire up Rhino
 * routing conventions that can't be expressed purely via @Controller decorators
 * (route group prefixes, tenant resolution middleware, skip-auth for public groups).
 *
 * NestJS has no built-in "register the same controller at multiple prefixes" API,
 * so the pattern here is:
 *
 *  1. Users register RhinoModule with their model + routeGroup config.
 *  2. Users expose a single Global/Auth/Invitation/Nested controller set
 *     (either by re-exporting from this library or by subclassing).
 *  3. The helper returns the metadata needed to install middleware chains.
 *
 * Route group expansion is done at request time by the `ResolveOrganization`
 * middleware — the tenant group's `:organization` param is the discriminator.
 */
export function applyRhinoRouting(
  app: INestApplication,
  options: RegisterRoutesOptions = {},
) {
  const prefix = options.prefix ?? 'api';
  app.setGlobalPrefix(prefix);
  return { prefix, enableAuth: options.enableAuth ?? true };
}

/**
 * Describe the resolved route table for documentation / postman export.
 */
export function describeRoutes(config: RhinoConfigService): Array<{
  group: string;
  slug: string;
  prefix: string;
  domain: string | null;
  model: string;
  softDeletes: boolean;
  hasAuditTrail: boolean;
  exceptActions: string[];
}> {
  const routes: any[] = [];
  const models = config.models();
  const groups = config.routeGroups();
  const groupNames = Object.keys(groups);
  const fallback = groupNames.length === 0 ? [[undefined, undefined]] : [];
  for (const name of groupNames) {
    const group = groups[name];
    const slugList = group.models === '*' ? Object.keys(models) : group.models;
    for (const slug of slugList) {
      const reg = models[slug];
      if (!reg) continue;
      routes.push({
        group: name,
        slug,
        prefix: group.prefix ?? '',
        domain: group.domain ?? null,
        model: reg.model,
        softDeletes: !!reg.softDeletes,
        hasAuditTrail: !!reg.hasAuditTrail,
        exceptActions: reg.exceptActions ?? [],
      });
    }
  }
  if (fallback.length > 0) {
    for (const [slug, reg] of Object.entries(models)) {
      routes.push({
        group: '(default)',
        slug,
        prefix: '',
        domain: null,
        model: reg.model,
        softDeletes: !!reg.softDeletes,
        hasAuditTrail: !!reg.hasAuditTrail,
        exceptActions: reg.exceptActions ?? [],
      });
    }
  }
  return routes;
}
