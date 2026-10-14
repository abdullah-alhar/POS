import {
  Body,
  Controller,
  HttpCode,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  generateBarcodesSchema,
  productImportSchema,
  productInputSchema,
  productQuerySchema,
  variantPricesSchema,
  type ProductImportInput,
  type ProductInputParsed,
  type ProductQuery,
  type VariantPricesInput,
} from '@marina/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ImportService } from './import.service';
import { PosIndexService } from './pos-index.service';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly importer: ImportService,
  ) {}

  @Get()
  @RequirePermissions('products.view')
  list(@Query(new ZodPipe(productQuerySchema)) query: ProductQuery) {
    return this.products.list(query);
  }

  /** Check (commit: false) or apply (commit: true) a spreadsheet of products. */
  @Post('import')
  @HttpCode(200)
  @RequirePermissions('products.manage')
  importRows(
    @Body(new ZodPipe(productImportSchema)) body: ProductImportInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.importer.run(body, actor);
  }

  @Get(':id')
  @RequirePermissions('products.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(id);
  }

  @Post()
  @RequirePermissions('products.manage')
  create(
    @Body(new ZodPipe(productInputSchema)) body: ProductInputParsed,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.create(body, actor);
  }

  @Put(':id')
  @RequirePermissions('products.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(productInputSchema)) body: ProductInputParsed,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.update(id, body, actor);
  }
}

@Controller('variants')
export class VariantsController {
  constructor(
    private readonly products: ProductsService,
    private readonly index: PosIndexService,
  ) {}

  /** Find an item by barcode or SKU. */
  @Get('lookup')
  lookup(@Query('code', new ZodPipe(z.string().trim().min(1, 'Enter a code'))) code: string) {
    return this.index.lookup(code);
  }

  @Patch(':id/prices')
  @RequirePermissions('products.manage')
  updatePrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(variantPricesSchema)) body: VariantPricesInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.updatePrices(id, body, actor);
  }
}

@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly index: PosIndexService,
  ) {}

  /** Everything the billing screen needs to scan offline. Express adds an ETag automatically. */
  @Get('catalog/pos-index')
  posIndex() {
    return this.index.build();
  }

  @Post('barcodes/generate')
  @RequirePermissions('products.manage')
  async generate(@Body(new ZodPipe(generateBarcodesSchema)) body: { count: number }) {
    return { codes: await this.products.generateBarcodes(body.count) };
  }
}
