import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async createOrder(
    @Body(ValidationPipe) createOrderDto: CreateOrderDto,
  ): Promise<Order> {
    return await this.ordersService.createOrder(createOrderDto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(@Param('id', ParseIntPipe) id: number): Promise<Order> {
    return await this.ordersService.cancelOrder(id);
  }

  @Get('user/:userId')
  async getOrdersByUser(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Order[]> {
    return await this.ordersService.getOrdersByUser(userId);
  }
}
