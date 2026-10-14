import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  brandInputSchema,
  categoryInputSchema,
  taxRateInputSchema,
  type BrandInput,
  type CategoryInput,
  type TaxRateInput,
} from '@marina/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { LookupsService } from './lookups.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly lookups: LookupsService) {}

  @Get()
  list() {
    return this.lookups.categories();
  }

  @Post()
  @RequirePermissions('products.manage')
  create(
    @Body(new ZodPipe(categoryInputSchema)) body: CategoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.lookups.createCategory(body, actor);
  }

  @Patch(':id')
  @RequirePermissions('products.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(categoryInputSchema)) body: CategoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.lookups.updateCategory(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('products.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    await this.lookups.deleteCategory(id, actor);
  }
}

@Controller('brands')
export class BrandsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get()
  list() {
    return this.lookups.brands();
  }

  @Post()
  @RequirePermissions('products.manage')
  create(@Body(new ZodPipe(brandInputSchema)) body: BrandInput, @CurrentActor() actor: Actor) {
    return this.lookups.createBrand(body, actor);
  }

  @Patch(':id')
  @RequirePermissions('products.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(brandInputSchema)) body: BrandInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.lookups.updateBrand(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('products.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    await this.lookups.deleteBrand(id, actor);
  }
}

@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly lookups: LookupsService) {}

  @Get()
  list() {
    return this.lookups.taxRates();
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body(new ZodPipe(taxRateInputSchema)) body: TaxRateInput, @CurrentActor() actor: Actor) {
    return this.lookups.saveTaxRate(null, body, actor);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(taxRateInputSchema)) body: TaxRateInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.lookups.saveTaxRate(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('settings.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    await this.lookups.deleteTaxRate(id, actor);
  }
}
