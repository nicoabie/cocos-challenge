import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { PortfolioService } from './portfolio.service';
import { Order } from '../orders/order.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { Instrument } from '../instruments/instrument.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Order, MarketData, Instrument])],
  controllers: [UsersController],
  providers: [UsersService, PortfolioService],
  exports: [UsersService],
})
export class UsersModule {}
