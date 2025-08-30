import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
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
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    describe('Market Orders', () => {
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
        const mockMarketData = { close: 150.0 };
        const mockCashInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };
        const mockOrders = [
          {
            side: OrderSide.CASH_IN,
            size: 100000,
            price: 1,
            status: OrderStatus.FILLED,
          },
        ];

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockCashInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockOrderRepository.find.mockResolvedValue(mockOrders);
        mockOrderRepository.create.mockReturnValue({
          ...createOrderDto,
          price: 150.0,
          status: OrderStatus.FILLED,
          datetime: new Date(),
        });
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          ...createOrderDto,
          price: 150.0,
          status: OrderStatus.FILLED,
          datetime: new Date(),
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.FILLED);
        expect(result.price).toBe(150.0);
        expect(mockOrderRepository.save).toHaveBeenCalled();
      });

      it('should reject a MARKET order when user has insufficient funds', async () => {
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
        const mockMarketData = { close: 150.0 };
        const mockCashInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };
        const mockOrders = [
          {
            side: OrderSide.CASH_IN,
            size: 1000,
            price: 1,
            status: OrderStatus.FILLED,
          },
        ];

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockCashInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockOrderRepository.find.mockResolvedValue(mockOrders);
        mockOrderRepository.create.mockReturnValue({
          ...createOrderDto,
          price: 150.0,
          status: OrderStatus.REJECTED,
          datetime: new Date(),
        });
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          ...createOrderDto,
          price: 150.0,
          status: OrderStatus.REJECTED,
          datetime: new Date(),
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.REJECTED);
        expect(mockOrderRepository.save).toHaveBeenCalled();
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

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne.mockResolvedValue(mockInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(null);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    describe('Limit Orders', () => {
      it('should create a LIMIT order with NEW status', async () => {
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
        const mockCashInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };
        const mockOrders = [
          {
            side: OrderSide.CASH_IN,
            size: 100000,
            price: 1,
            status: OrderStatus.FILLED,
          },
        ];

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockCashInstrument);
        mockOrderRepository.find.mockResolvedValue(mockOrders);
        mockOrderRepository.create.mockReturnValue({
          ...createOrderDto,
          status: OrderStatus.NEW,
          datetime: new Date(),
        });
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          ...createOrderDto,
          status: OrderStatus.NEW,
          datetime: new Date(),
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.status).toBe(OrderStatus.NEW);
        expect(result.price).toBe(145.0);
        expect(mockOrderRepository.save).toHaveBeenCalled();
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

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne.mockResolvedValue(mockInstrument);

        await expect(service.createOrder(createOrderDto)).rejects.toThrow(
          BadRequestException,
        );
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
        const mockMarketData = { close: 150.0 };
        const mockCashInstrument = { id: 66, ticker: 'ARS', type: 'MONEDA' };
        const mockOrders = [
          {
            side: OrderSide.CASH_IN,
            size: 100000,
            price: 1,
            status: OrderStatus.FILLED,
          },
        ];

        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockInstrumentRepository.findOne
          .mockResolvedValueOnce(mockInstrument)
          .mockResolvedValueOnce(mockCashInstrument);
        mockMarketDataRepository.findOne.mockResolvedValue(mockMarketData);
        mockOrderRepository.find.mockResolvedValue(mockOrders);
        mockOrderRepository.create.mockReturnValue({
          userId: 1,
          instrumentId: 1,
          size: 100,
          price: 150.0,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
          datetime: new Date(),
        });
        mockOrderRepository.save.mockResolvedValue({
          id: 1,
          userId: 1,
          instrumentId: 1,
          size: 100,
          price: 150.0,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
          datetime: new Date(),
        });

        const result = await service.createOrder(createOrderDto);

        expect(result.size).toBe(100);
        expect(mockOrderRepository.save).toHaveBeenCalled();
      });
    });
  });

  describe('cancelOrder', () => {
    it('should cancel an order with NEW status', async () => {
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

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockOrderRepository.save.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(orderId);

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockOrderRepository.save).toHaveBeenCalled();
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
