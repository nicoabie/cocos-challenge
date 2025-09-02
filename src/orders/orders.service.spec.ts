import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { Balance } from '../balances/balance.entity';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockOrderRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Instrument),
          useValue: {},
        },
        {
          provide: getRepositoryToken(MarketData),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Balance),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Note: Order creation, cancellation, and validation are thoroughly tested
  // in integration tests (orders.e2e-spec.ts) with real database interactions.
  // This unit test focuses on methods not covered by HTTP endpoints.

  describe('getOrdersByUser', () => {
    it('should return orders for a specific user', async () => {
      const userId = 1;
      const mockOrders = [
        {
          id: 1,
          userId,
          instrumentId: 1,
          size: 10,
          price: 150.0,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
          datetime: new Date(),
          instrument: {
            id: 1,
            ticker: 'AAPL',
            name: 'Apple Inc.',
            type: 'ACCIONES',
          },
        },
        {
          id: 2,
          userId,
          instrumentId: 2,
          size: 5,
          price: 200.0,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
          datetime: new Date(),
          instrument: {
            id: 2,
            ticker: 'GOOGL',
            name: 'Google',
            type: 'ACCIONES',
          },
        },
      ];

      mockOrderRepository.find.mockResolvedValue(mockOrders);

      const result = await service.getOrdersByUser(userId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockOrders);
      expect(mockOrderRepository.find).toHaveBeenCalledWith({
        where: { userId },
        relations: ['instrument'],
        order: { datetime: 'DESC' },
      });
    });
  });
});
