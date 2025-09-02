import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { Balance } from '../balances/balance.entity';
import { CreateOrderDto } from './dto/create-order.dto';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockOrderRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockInstrumentRepository = {
    findOne: jest.fn(),
  };

  const mockMarketDataRepository = {
    findOne: jest.fn(),
  };

  const mockBalancesRepository = {
    findOne: jest.fn(),
  };

  const mockManager = {
    getRepository: jest.fn(),
    query: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Instrument),
          useValue: mockInstrumentRepository,
        },
        {
          provide: getRepositoryToken(MarketData),
          useValue: mockMarketDataRepository,
        },
        {
          provide: getRepositoryToken(Balance),
          useValue: mockBalancesRepository,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);

    mockManager.getRepository.mockReturnValue(mockOrderRepository);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    mockDataSource.transaction.mockImplementation((cb) => cb(mockManager));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    describe('Validation', () => {
      it('should throw error when neither size nor totalAmount is provided', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = { id: 1, email: 'test@test.com' };
        const mockInstrument = { id: 1, ticker: 'AAPL', name: 'Apple Inc.' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne.mockResolvedValue(mockInstrument);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should throw error when trying to buy or sell ARS', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 66,
          size: 100,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = { id: 1, email: 'test@test.com' };
        const mockArsInstrument = { id: 66, ticker: 'ARS' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockArsInstrument)
          .mockResolvedValueOnce(mockArsInstrument);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should throw error when user does not exist', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 999,
          instrumentId: 1,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        mockUserRepository.findOne.mockResolvedValue(null);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('should throw error when instrument does not exist', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 999,
          size: 10,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
          price: 100,
        };

        const mockUser = { id: 1, email: 'test@test.com' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne.mockResolvedValue(null);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('Market Orders - BUY', () => {
      it('should create a MARKET BUY order successfully', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockMarketData = { previousClose: 150.0 };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockManager.query
          .mockResolvedValueOnce([{ available: '100000' }])
          .mockResolvedValueOnce([]);
        mockOrderRepository.save
          .mockResolvedValueOnce({
            id: 1,
            userId: 1,
            instrumentId: 1,
            price: 150.0,
            size: 10,
            side: OrderSide.BUY,
            status: OrderStatus.FILLED,
            type: OrderType.MARKET,
          })
          .mockResolvedValueOnce({
            userId: 1,
            instrumentId: 66,
            price: 1,
            size: 1500,
            side: OrderSide.CASH_OUT,
            status: OrderStatus.FILLED,
            type: OrderType.MARKET,
          });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.FILLED);
        expect(result.price).toBe(150.0);
        expect(mockOrderRepository.save).toHaveBeenCalledTimes(2);
      });

      it('should reject a MARKET BUY order when user has insufficient funds', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 1000,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockMarketData = { previousClose: 150.0 };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockManager.query.mockResolvedValueOnce([{ available: '1000' }]);
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          userId: 1,
          instrumentId: 1,
          price: 150.0,
          size: 1000,
          side: OrderSide.BUY,
          status: OrderStatus.REJECTED,
          type: OrderType.MARKET,
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.REJECTED);
        expect(mockOrderRepository.save).toHaveBeenCalledWith({
          userId: 1,
          instrumentId: 1,
          side: OrderSide.BUY,
          size: 1000,
          price: 150.0,
          type: OrderType.MARKET,
          status: OrderStatus.REJECTED,
        });
      });

      it('should throw error when no market data is available', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(null);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    describe('Market Orders - SELL', () => {
      it('should create a MARKET SELL order successfully', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockMarketData = { previousClose: 150.0 };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockManager.query
          .mockResolvedValueOnce([{ available: '50' }])
          .mockResolvedValueOnce([]);
        mockOrderRepository.save
          .mockResolvedValueOnce({
            id: 1,
            userId: 1,
            instrumentId: 1,
            price: 150.0,
            size: 10,
            side: OrderSide.SELL,
            status: OrderStatus.FILLED,
            type: OrderType.MARKET,
          })
          .mockResolvedValueOnce({
            userId: 1,
            instrumentId: 66,
            price: 1,
            size: 1500,
            side: OrderSide.CASH_IN,
            status: OrderStatus.FILLED,
            type: OrderType.MARKET,
          });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.FILLED);
        expect(result.price).toBe(150.0);
        expect(mockOrderRepository.save).toHaveBeenCalledTimes(2);
      });

      it('should reject a MARKET SELL order when user has insufficient shares', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 100,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockMarketData = { previousClose: 150.0 };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockManager.query.mockResolvedValueOnce([{ available: '10' }]);
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          userId: 1,
          instrumentId: 1,
          price: 150.0,
          size: 100,
          side: OrderSide.SELL,
          status: OrderStatus.REJECTED,
          type: OrderType.MARKET,
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.REJECTED);
      });
    });

    describe('Limit Orders - BUY', () => {
      it('should create a LIMIT BUY order with NEW status', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          price: 145.0,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockManager.query
          .mockResolvedValueOnce([{ available: '100000' }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        mockOrderRepository.save
          .mockResolvedValueOnce({
            id: 1,
            userId: 1,
            instrumentId: 1,
            price: 145.0,
            size: 10,
            side: OrderSide.BUY,
            status: OrderStatus.NEW,
            type: OrderType.LIMIT,
          })
          .mockResolvedValueOnce({
            userId: 1,
            instrumentId: 66,
            price: 1,
            size: 1450,
            side: OrderSide.CASH_OUT,
            status: OrderStatus.NEW,
            type: OrderType.LIMIT,
          });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.NEW);
        expect(result.price).toBe(145.0);
        expect(mockOrderRepository.save).toHaveBeenCalledTimes(2);
        expect(mockManager.query).toHaveBeenCalledTimes(3);
      });

      it('should throw error when price is not provided for LIMIT order', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    describe('Limit Orders - SELL', () => {
      it('should create a LIMIT SELL order with NEW status', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          size: 10,
          price: 155.0,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockManager.query.mockResolvedValueOnce([{ available: '50' }]);
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          userId: 1,
          instrumentId: 1,
          price: 155.0,
          size: 10,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
          type: OrderType.LIMIT,
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.NEW);
        expect(result.price).toBe(155.0);
        expect(mockOrderRepository.save).toHaveBeenCalledTimes(1);
      });
    });

    describe('Total Amount Calculation', () => {
      it('should calculate size from totalAmount for MARKET orders', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          totalAmount: 15000,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockMarketData = { previousClose: 150.0 };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockManager.query
          .mockResolvedValueOnce([{ available: '100000' }])
          .mockResolvedValueOnce([]);
        mockOrderRepository.save
          .mockResolvedValueOnce({
            id: 1,
            userId: 1,
            instrumentId: 1,
            size: 100,
            price: 150.0,
            type: OrderType.MARKET,
            side: OrderSide.BUY,
            status: OrderStatus.FILLED,
            datetime: new Date(),
          })
          .mockResolvedValueOnce({
            userId: 1,
            instrumentId: 66,
            price: 1,
            size: 15000,
            side: OrderSide.CASH_OUT,
            status: OrderStatus.FILLED,
            type: OrderType.MARKET,
          });

        const result = await service.createOrder(createOrderDto);

        expect(result.size).toBe(100);
        expect(mockOrderRepository.save).toHaveBeenCalledTimes(2);
      });

      it('should calculate size from totalAmount for LIMIT orders', async () => {
        const createOrderDto: CreateOrderDto = {
          userId: 1,
          instrumentId: 1,
          totalAmount: 14500,
          price: 145.0,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const mockUser = {
          id: 1,
          email: 'test@test.com',
          accountNumber: '10001',
        };
        const mockInstrument = {
          id: 1,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          type: 'ACCIONES',
        };
        const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockArsInstrument);
        mockManager.query
          .mockResolvedValueOnce([{ available: '100000' }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        mockOrderRepository.save
          .mockResolvedValueOnce({
            id: 1,
            userId: 1,
            instrumentId: 1,
            size: 100,
            price: 145.0,
            type: OrderType.LIMIT,
            side: OrderSide.BUY,
            status: OrderStatus.NEW,
          })
          .mockResolvedValueOnce({
            userId: 1,
            instrumentId: 66,
            price: 1,
            size: 14500,
            side: OrderSide.CASH_OUT,
            status: OrderStatus.NEW,
            type: OrderType.LIMIT,
          });

        const result = await service.createOrder(createOrderDto);

        expect(result.size).toBe(100);
        expect(result.price).toBe(145.0);
      });
    });
  });

  describe('cancelOrder', () => {
    it('should cancel a BUY order with NEW status and rollback balances', async () => {
      const orderId = 1;
      const mockOrder = {
        id: orderId,
        status: OrderStatus.NEW,
        userId: 1,
        instrumentId: 1,
        size: 10,
        price: 145.0,
        type: OrderType.LIMIT,
        side: OrderSide.BUY,
        datetime: new Date(),
      };
      const mockArsInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockInstrumentRepository.findOne.mockResolvedValue(mockArsInstrument);
      mockOrderRepository.save.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      });
      mockManager.query.mockResolvedValue([]);

      const result = await service.cancelOrder(orderId);

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockManager.query).toHaveBeenCalledWith(
        'UPDATE balances SET quantity = quantity + $1, reserved = reserved - $1 WHERE userid = $2 AND instrumentid = $3',
        [1450, 1, 66],
      );
    });

    it('should cancel a SELL order without balance rollback', async () => {
      const orderId = 2;
      const mockOrder = {
        id: orderId,
        status: OrderStatus.NEW,
        userId: 1,
        instrumentId: 1,
        size: 5,
        price: 150.0,
        type: OrderType.LIMIT,
        side: OrderSide.SELL,
        datetime: new Date(),
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockOrderRepository.save.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(orderId);

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('should throw error when trying to cancel a FILLED order', async () => {
      const orderId = 1;
      const mockOrder = {
        id: orderId,
        status: OrderStatus.FILLED,
        userId: 1,
        instrumentId: 1,
        size: 10,
        price: 150.0,
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        datetime: new Date(),
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);

      await expect(service.cancelOrder(orderId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw error when order does not exist', async () => {
      const orderId = 999;
      mockOrderRepository.findOne.mockResolvedValue(null);

      await expect(service.cancelOrder(orderId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

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
