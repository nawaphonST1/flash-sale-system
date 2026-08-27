import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryColumn()
  productId!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  price!: number;

  @Column()
  availableStock!: number;

  @Column({ default: 0 })
  remainingStock!: number;

  @Column()
  isFlashSaleActive!: boolean;
}