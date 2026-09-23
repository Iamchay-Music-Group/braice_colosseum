import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    if (dto.walletAddress) {
      const existing = await this.userRepo.findOne({
        where: { walletAddress: dto.walletAddress },
      });
      if (existing) {
        throw new ConflictException('Wallet address already registered');
      }
    }

    const user = this.userRepo.create({
      displayName: dto.displayName,
      walletAddress: dto.walletAddress ?? null,
      email: dto.email ?? null,
      userType: dto.userType,
    });

    return this.userRepo.save(user);
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async findByWallet(walletAddress: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { walletAddress } });
    if (!user) {
      throw new NotFoundException(`User with wallet ${walletAddress} not found`);
    }
    return user;
  }

  async findAll(): Promise<User[]> {
    return this.userRepo.find({ order: { createdAt: 'DESC' } });
  }
}
