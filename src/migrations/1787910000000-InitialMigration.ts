import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1787910000000 implements MigrationInterface {
  name = 'InitialMigration1787910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create products table with Check constraint
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "productId" character varying NOT NULL,
        "name" character varying NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "price" numeric(10,2) NOT NULL DEFAULT '0',
        "availableStock" integer NOT NULL DEFAULT 0,
        "remainingStock" integer NOT NULL DEFAULT 0,
        "isFlashSaleActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("productId"),
        CONSTRAINT "CHK_products_availableStock" CHECK ("availableStock" >= 0)
      )
    `);

    // 2. Create orders table with Unique constraint
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "orderId" character varying NOT NULL,
        "userId" character varying NOT NULL,
        "productId" character varying NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "price" numeric(10,2) NOT NULL DEFAULT '0',
        "totalAmount" numeric(10,2) NOT NULL DEFAULT '0',
        "status" character varying NOT NULL DEFAULT 'PENDING',
        "failureReason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("orderId"),
        CONSTRAINT "UQ_user_product_order" UNIQUE ("userId", "productId")
      )
    `);

    // 3. Create index on products for fast pagination / lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_productId" ON "products" ("productId");
      CREATE INDEX IF NOT EXISTS "IDX_orders_userId_productId" ON "orders" ("userId", "productId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_userId_productId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_productId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
  }
}
