import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { RHINO_PRISMA_CLIENT } from '../constants/tokens';

/**
 * Minimal PrismaClient surface Rhino relies on. Declared structurally so
 * the library does not take a hard dep on `@prisma/client` (peer dep only).
 */
export interface PrismaClientLike {
  $connect?: () => Promise<void>;
  $disconnect?: () => Promise<void>;
  $transaction?: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
  [model: string]: any;
}

/**
 * Wraps the consuming app's PrismaClient. The client is provided to
 * `RhinoModule.forRoot({ prismaClient })` and injected via DI — no
 * post-construction `setClient()` dance required.
 *
 * For type-safe access, declare a subclass typed over your generated client:
 *
 *   class AppPrisma extends PrismaService<PrismaClient> {}
 *
 * and inject `AppPrisma` instead of `PrismaService`.
 */
@Injectable()
export class PrismaService<TClient extends PrismaClientLike = PrismaClientLike>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private _client: TClient | undefined;

  constructor(@Optional() @Inject(RHINO_PRISMA_CLIENT) client?: TClient) {
    this._client = client;
  }

  async onModuleInit() {
    if (this._client?.$connect) {
      try {
        await this._client.$connect();
      } catch (err) {
        this.logger.warn(`Prisma $connect failed: ${(err as Error).message}`);
      }
    }
  }

  async onModuleDestroy() {
    if (this._client?.$disconnect) {
      try {
        await this._client.$disconnect();
      } catch (err) {
        this.logger.warn(`Prisma $disconnect failed: ${(err as Error).message}`);
      }
    }
  }

  /** Escape hatch for tests. Not intended for production code. */
  setClient(client: TClient) {
    this._client = client;
  }

  get client(): TClient {
    if (!this._client) {
      throw new Error(
        'PrismaService: no Prisma client configured. ' +
          'Pass it via RhinoModule.forRoot({ prismaClient: new PrismaClient() }) ' +
          'or RhinoModule.forRootAsync({ useFactory: () => ({ prismaClient, ... }) }).',
      );
    }
    return this._client;
  }

  /**
   * Resolve a Prisma delegate by model name, trying original / camelCase / lowercase.
   * Returns `any` at the library level; subclass with generics for type inference.
   */
  model(name: string): any {
    const client = this.client as any;
    const candidates = [
      name,
      name.charAt(0).toLowerCase() + name.slice(1),
      name.toLowerCase(),
    ];
    for (const c of candidates) {
      const d = client[c];
      if (d && typeof d === 'object') return d;
    }
    throw new Error(`PrismaService: unknown model "${name}"`);
  }

  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const tx = (this.client as any).$transaction;
    if (!tx) throw new Error('PrismaService: configured client does not support $transaction');
    return tx(fn);
  }
}
