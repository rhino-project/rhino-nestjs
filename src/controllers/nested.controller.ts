import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
} from '@nestjs/common';
import { NestedService, NestedOperation } from '../services/nested.service';
import { RhinoConfigService } from '../rhino.config';
import { ResourcePolicy } from '../policies/resource-policy';

@Controller('nested')
export class NestedController {
  constructor(
    private readonly nested: NestedService,
    private readonly config: RhinoConfigService,
  ) {}

  @Post()
  async run(
    @Body() body: { operations: NestedOperation[] },
    @Req() req: any,
  ) {
    const ops = body?.operations ?? [];
    if (!Array.isArray(ops)) throw new BadRequestException('operations must be an array');
    // Authorize each operation via its model policy before execution
    for (const [i, op] of ops.entries()) {
      const reg = this.config.model(op.model);
      if (!reg) throw new BadRequestException(`Unknown model at ${i}: ${op.model}`);
      const PolicyClass = reg.policy ?? ResourcePolicy;
      const policy = new PolicyClass();
      policy.resourceSlug = op.model;
      const allowed =
        op.action === 'create'
          ? policy.create(req.user, req.organization)
          : op.action === 'update'
            ? policy.update(req.user, null, req.organization)
            : policy.delete(req.user, null, req.organization);
      if (!allowed) {
        throw new ForbiddenException(`Unauthorized operation at index ${i}`);
      }
    }
    const results = await this.nested.execute(ops, {
      user: req.user,
      organization: req.organization,
    });
    return { data: results };
  }
}
