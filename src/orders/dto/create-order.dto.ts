import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { OrderSide, OrderType } from '../order.entity';

export class CreateOrderDto {
  @IsNumber()
  @IsPositive()
  instrumentId: number;

  @IsNumber()
  @IsPositive()
  userId: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  size?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  totalAmount?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsEnum(OrderType)
  type: OrderType;

  @IsEnum(OrderSide)
  side: OrderSide;
}
