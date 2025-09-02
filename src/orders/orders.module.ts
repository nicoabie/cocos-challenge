import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { Balance } from '../balances/balance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User, Instrument, MarketData, Balance]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
