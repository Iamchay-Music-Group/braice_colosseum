import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let usersService: {
    findAll: jest.Mock;
    findById: jest.Mock;
    findByWallet: jest.Mock;
  };

  beforeAll(async () => {
    usersService = {
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/users', () => {
    // This endpoint used to be public and accepted an arbitrary userType,
    // which let anyone self-register as a CREATOR. Account creation now
    // lives at POST /api/auth/register, which takes email + password and
    // always creates a MEMBER.
    it('no longer exists', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ displayName: 'Attacker', userType: 'CREATOR' })
        .expect(404);
    });

    it('cannot be reached to mint a privileged account', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ displayName: 'Attacker', userType: 'CREATOR' });

      expect(res.status).not.toBe(201);
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

    // `wallet/:address` must be declared before `:id`, otherwise the wallet
    // route is shadowed and the two-segment path 404s.
    it('is not shadowed by the :id route', () => {
      usersService.findByWallet.mockResolvedValue({ id: 'uuid-1' });

      return request(app.getHttpServer())
        .get('/api/users/wallet/wallet_abc')
        .expect(200)
        .expect(() => {
          expect(usersService.findByWallet).toHaveBeenCalled();
          expect(usersService.findById).not.toHaveBeenCalled();
        });
    });
  });
});
