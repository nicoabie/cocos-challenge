import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { Instrument } from '../instruments/instrument.entity';
import { User } from '../users/user.entity';

@Entity('balances')
export class Balance {
  @PrimaryColumn({ name: 'instrumentid' })
  instrumentId: number;

  @PrimaryColumn({ name: 'userid' })
  userId: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  quantity: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  reserved: number;

  @ManyToOne(() => Instrument)
  @JoinColumn({ name: 'instrumentid' })
  instrument: Instrument;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userid' })
  user: User;
}
