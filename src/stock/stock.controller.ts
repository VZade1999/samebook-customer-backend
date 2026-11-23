import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { StockService } from './stock.service';

/**
 * Stock & warehouses. Everything is scoped to the caller's company (from the
 * token). Seeing stock needs products.view (warehouse cards: warehouses.view);
 * receiving, moving and counting need stock.manage.
 */
@Controller('stock')
@UseGuards(AuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** The stock table: each tracked product across your warehouses. */
  @Get('/levels')
  @RequirePermissions('products.view')
  levels(@Req() req: any, @Query() query: any) {
    return this.stock.levels(req.user?.company_id, query || {});
  }

  /** Warehouse cards with their figures. */
  @Get('/warehouses')
  @RequirePermissions('warehouses.view')
  warehouses(@Req() req: any) {
    return this.stock.warehouses(req.user?.company_id);
  }

  /** The history of every stock change. */
  @Get('/history')
  @RequirePermissions('products.view')
  history(@Req() req: any, @Query() query: any) {
    return this.stock.history(req.user?.company_id, query || {});
  }

  /** Goods arrived at a warehouse. */
  @Post('/receive')
  @RequirePermissions('stock.manage')
  receive(@Req() req: any, @Body() body: any) {
    return this.stock.receive(req.user?.company_id, req.user?.user_id ?? null, body);
  }

  /** Move stock between two warehouses. */
  @Post('/move')
  @RequirePermissions('stock.manage')
  move(@Req() req: any, @Body() body: any) {
    return this.stock.move(req.user?.company_id, req.user?.user_id ?? null, body);
  }

  /** Set stock to what was counted. */
  @Post('/count')
  @RequirePermissions('stock.manage')
  count(@Req() req: any, @Body() body: any) {
    return this.stock.count(req.user?.company_id, req.user?.user_id ?? null, body);
  }

  /** Keep a product in a warehouse (rack / shelf), or stop keeping it there. */
  @Put('/location')
  @RequirePermissions('stock.manage')
  location(@Req() req: any, @Body() body: any) {
    return this.stock.setLocation(req.user?.company_id, body);
  }
}
