import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { config } from './config';
import { AssistantModule } from './modules/assistant/assistant.controller';
import { AuditViewModule } from './modules/audit/audit.controller';
import { AuditModule } from './modules/audit/audit.service';
import { BackupsModule } from './modules/backups/backups.controller';
import { AuthModule } from './modules/auth/auth.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.controller';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.controller';
import { ExpensesModule } from './modules/expenses/expenses.controller';
import { InventoryModule } from './modules/inventory/inventory.controller';
import { PrintingModule } from './modules/printing/printing.controller';
import { ReportsModule } from './modules/reports/reports.controller';
import { PurchasesModule } from './modules/purchases/purchases.controller';
import { ReturnsModule } from './modules/returns/returns.controller';
import { SuppliersModule } from './modules/suppliers/suppliers.controller';
import { SalesModule } from './modules/sales/sales.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SystemModule } from './modules/system/system.controller';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

/** In production the API also serves the built web app, so there is only one program to run. */
function webApp(): DynamicModule[] {
  const dir = config().webDistDir;
  if (!existsSync(join(dir, 'index.html'))) return [];
  return [
    ServeStaticModule.forRoot({
      rootPath: dir,
      exclude: ['/api/{*rest}'],
    }),
  ];
}

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CashRegisterModule,
    SalesModule,
    PrintingModule,
    InventoryModule,
    SuppliersModule,
    PurchasesModule,
    ReturnsModule,
    CustomersModule,
    ExpensesModule,
    SystemModule,
    ReportsModule,
    AuditViewModule,
    BackupsModule,
    AssistantModule,
    ...webApp(),
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
