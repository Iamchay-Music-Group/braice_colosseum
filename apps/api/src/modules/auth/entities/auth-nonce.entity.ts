import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('auth_nonces')
export class AuthNonce {
  @PrimaryColumn({ type: 'text' })
  nonce!: string;

  @Index()
  @Column({ name: 'wallet_address', type: 'text' })
  walletAddress!: string;

  @Column({ type: 'text' })
  message!: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
