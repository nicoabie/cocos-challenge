import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const postgresConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'postgres',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false, // No usar en producción
  logging: process.env.NODE_ENV === 'development',
};
