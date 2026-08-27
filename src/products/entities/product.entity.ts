import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('products')
@Check('"availableStock" >= 0')
export class Product {
  @PrimaryColumn()
  productId!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price!: number;

  @Column()
  availableStock!: number;

  @Column()
  isFlashSaleActive!: boolean;
}