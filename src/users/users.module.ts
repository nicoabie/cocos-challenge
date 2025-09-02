import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { BalancesService } from '../balances/balances.service';
import { Order } from '../orders/order.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { Instrument } from '../instruments/instrument.entity';
import { Balance } from '../balances/balance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Order, MarketData, Instrument, Balance]),
  ],
  controllers: [UsersController],
  providers: [UsersService, BalancesService],
  exports: [UsersService],
})
export class UsersModule {}
