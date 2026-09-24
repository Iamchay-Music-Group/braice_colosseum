import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserDto, CreateUserType } from './dto/create-user.dto';

type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: MockRepo<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo() },
      ],
    }).compile();

    service = module.get(UsersService);
    repo = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a user without wallet', async () => {
      const dto: CreateUserDto = {
        displayName: 'Test User',
        userType: CreateUserType.MEMBER,
      };
      const savedUser = { id: 'uuid-1', ...dto, walletAddress: null, email: null, createdAt: new Date() };

      repo.findOne!.mockResolvedValue(null);
      repo.create!.mockReturnValue(savedUser);
      repo.save!.mockResolvedValue(savedUser);

      const result = await service.create(dto);

      expect(result).toEqual(savedUser);
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith({
        displayName: 'Test User',
        walletAddress: null,
        email: null,
        userType: 'MEMBER',
      });
    });

    it('should create a user with wallet address', async () => {
      const dto: CreateUserDto = {
        displayName: 'Wallet User',
        userType: CreateUserType.CREATOR,
        walletAddress: 'wallet_abc',
      };
      const savedUser = { id: 'uuid-2', ...dto, email: null, createdAt: new Date() };

      repo.findOne!.mockResolvedValue(null);
      repo.create!.mockReturnValue(savedUser);
      repo.save!.mockResolvedValue(savedUser);

      const result = await service.create(dto);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { walletAddress: 'wallet_abc' } });
      expect(result).toEqual(savedUser);
    });

    it('should throw ConflictException on duplicate wallet', async () => {
      const dto: CreateUserDto = {
        displayName: 'Dup User',
        userType: CreateUserType.MEMBER,
        walletAddress: 'wallet_dup',
      };

      repo.findOne!.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should not check wallet if not provided', async () => {
      const dto: CreateUserDto = {
        displayName: 'No Wallet',
        userType: CreateUserType.MEMBER,
      };

      repo.create!.mockReturnValue({ id: 'uuid-3' });
      repo.save!.mockResolvedValue({ id: 'uuid-3' });

      await service.create(dto);

      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      const user = { id: 'uuid-1', displayName: 'Test' };
      repo.findOne!.mockResolvedValue(user);

      const result = await service.findById('uuid-1');

      expect(result).toEqual(user);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('should throw NotFoundException for missing user', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWallet', () => {
    it('should return a user by wallet address', async () => {
      const user = { id: 'uuid-1', walletAddress: 'wallet_abc' };
      repo.findOne!.mockResolvedValue(user);

      const result = await service.findByWallet('wallet_abc');

      expect(result).toEqual(user);
    });

    it('should throw NotFoundException for unknown wallet', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findByWallet('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all users ordered by createdAt DESC', async () => {
      const users = [
        { id: '2', createdAt: new Date('2026-09-24') },
        { id: '1', createdAt: new Date('2026-09-23') },
      ];
      repo.find!.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });
});
