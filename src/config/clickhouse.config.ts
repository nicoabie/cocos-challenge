import { ClickHouseModuleOptions } from '@depyronick/nestjs-clickhouse';
import * as dotenv from 'dotenv';

dotenv.config();

export const clickhouseConfig: ClickHouseModuleOptions = {
  host: process.env.CLICKHOUSE_DB_HOST ?? 'localhost',
  port: parseInt(process.env.CLICKHOUSE_DB_PORT ?? '8123', 10),
  username: process.env.CLICKHOUSE_DB_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_DB_PASSWORD ?? 'clickhouse',
  database: process.env.CLICKHOUSE_DB_NAME ?? 'default',
};
