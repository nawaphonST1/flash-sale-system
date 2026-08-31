import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Order } from './orders/entities/order.entity';
import { Product } from './products/entities/product.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5433),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '30395077ee7c76e1f637a08584f76a37',
  database: process.env.DB_NAME || 'flash_sale_db',
  entities: [Product, Order],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
