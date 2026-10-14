import { Module } from '@nestjs/common';
import { BrandsController, CategoriesController, TaxRatesController } from './lookups.controller';
import { ImportService } from './import.service';
import { LookupsService } from './lookups.service';
import { PosIndexService } from './pos-index.service';
import { CatalogController, ProductsController, VariantsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [
    CategoriesController,
    BrandsController,
    TaxRatesController,
    ProductsController,
    VariantsController,
    CatalogController,
  ],
  providers: [LookupsService, ProductsService, PosIndexService, ImportService],
  exports: [ProductsService, PosIndexService],
})
export class CatalogModule {}
