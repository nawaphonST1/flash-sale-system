import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

@Entity('orders')
@Unique('UQ_user_product_order', ['userId', 'productId'])
export class Order {
  @PrimaryColumn()
  orderId!: string;

  @Column()
  userId!: string;

  @Column()
  productId!: string;

  @Column({ default: 1 })
  quantity!: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  price!: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  totalAmount!: number;

  @Column({
    type: 'varchar',
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
