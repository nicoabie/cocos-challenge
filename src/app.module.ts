import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { postgresConfig } from './config/postgres.config';
import { ClickHouseModule } from '@depyronick/nestjs-clickhouse';
import { clickhouseConfig } from './config/clickhouse.config';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRoot(postgresConfig),
    ClickHouseModule.register([clickhouseConfig]),
    UsersModule,
    InstrumentsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
