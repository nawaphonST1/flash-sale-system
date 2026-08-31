const { Client } = require('pg');
const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

async function resetSystem() {
  console.log('🔄 Starting Flash Sale System Reset...');

  // 1. Reset Redis (Flush locks, cache, queues, and init product stock)
  try {
    const redisHost = process.env.REDIS_HOST || '127.0.0.1';
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    const redis = new Redis({ host: redisHost, port: redisPort });

    await redis.flushall();
    // Initialize stock in Redis for fast-path atomic decrements
    await redis.set('stock:p-1001', 50);
    await redis.set('product:stock:p-1001', 50);
    await redis.quit();
    console.log('  ✅ Redis cleared & stock:p-1001 initialized to 50');
  } catch (err) {
    console.error('  ❌ Redis reset failed:', err.message);
  }

  // 2. Reset PostgreSQL Database (Truncate orders, restore stock to 50)
  try {
    const dbClient = new Client({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5433),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '30395077ee7c76e1f637a08584f76a37',
      database: process.env.DB_NAME || 'flash_sale_db',
    });

    await dbClient.connect();

    // Clean orders table
    await dbClient.query('TRUNCATE TABLE orders;');
    // Reset product stock
    await dbClient.query(`
      UPDATE products 
      SET "availableStock" = 50, "remainingStock" = 50 
      WHERE "productId" = 'p-1001';
    `);

    await dbClient.end();
    console.log('  ✅ PostgreSQL orders table truncated & p-1001 stock reset to 50');
  } catch (err) {
    console.error('  ❌ Database reset failed:', err.message);
  }

  console.log('✨ System is 100% FRESH and ready for Load Test!\n');
}

resetSystem();
