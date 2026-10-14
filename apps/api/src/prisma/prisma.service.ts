import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config';
import { PrismaClient, type Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: config().databaseUrl, max: 10 }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
