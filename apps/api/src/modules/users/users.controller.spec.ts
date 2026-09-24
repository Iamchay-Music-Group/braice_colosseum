import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let usersService: { create: jest.Mock; findAll: jest.Mock; findById: jest.Mock; findByWallet: jest.Mock };

  beforeAll(async () => {
    usersService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findByWallet: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/users', () => {
    it('should create a user', () => {
      const user = { id: 'uuid-1', displayName: 'Test', userType: 'MEMBER', createdAt: new Date() };
      usersService.create.mockResolvedValue(user);

      return request(app.getHttpServer())
        .post('/api/users')
        .send({ displayName: 'Test', userType: 'MEMBER' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.id).toBe('uuid-1');
          expect(res.body.displayName).toBe('Test');
        });
    });

    it('should reject invalid userType', () => {
      return request(app.getHttpServer())
        .post('/api/users')
        .send({ displayName: 'Test', userType: 'INVALID' })
        .expect(400);
    });

    it('should reject missing displayName', () => {
      return request(app.getHttpServer())
        .post('/api/users')
        .send({ userType: 'MEMBER' })
        .expect(400);
    });

    it('should reject unknown fields', () => {
      return request(app.getHttpServer())
        .post('/api/users')
        .send({ displayName: 'Test', userType: 'MEMBER', extra: 'field' })
        .expect(400);
    });
  });

  describe('GET /api/users', () => {
    it('should return all users', () => {
      const users = [{ id: '1', displayName: 'A' }, { id: '2', displayName: 'B' }];
      usersService.findAll.mockResolvedValue(users);

      return request(app.getHttpServer())
        .get('/api/users')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(2);
        });
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return a user by id', () => {
      const user = { id: 'uuid-1', displayName: 'Test' };
      usersService.findById.mockResolvedValue(user);

      return request(app.getHttpServer())
        .get('/api/users/uuid-1')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.id).toBe('uuid-1');
        });
    });

    it('should return 404 for missing user', () => {
      const { NotFoundException } = require('@nestjs/common');
      usersService.findById.mockRejectedValue(new NotFoundException());

      return request(app.getHttpServer())
        .get('/api/users/nonexistent')
        .expect(404);
    });
  });

  describe('GET /api/users/wallet/:address', () => {
    it('should return a user by wallet', () => {
      const user = { id: 'uuid-1', walletAddress: 'wallet_abc' };
      usersService.findByWallet.mockResolvedValue(user);

      return request(app.getHttpServer())
        .get('/api/users/wallet/wallet_abc')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.walletAddress).toBe('wallet_abc');
        });
    });
  });
});
