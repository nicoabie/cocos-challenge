import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderSide, OrderStatus, OrderType } from '../src/orders/order.entity';

interface OrderResponse {
  id: number;
  status: OrderStatus;
  userId: number;
  instrumentId: number;
  size: number;
  price: number;
  type: OrderType;
  side: OrderSide;
}

interface ErrorResponse {
  message: string;
  statusCode: number;
}

describe('Orders (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let testUserId: number;
  let testAaplId: number;
  let testArsId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());

    dataSource = moduleFixture.get<DataSource>(DataSource);

    await app.init();

    // Set up persistent test data that will be used across all tests

    // Ensure we have a test user
    const users = await dataSource.query<{ id: number; email: string }[]>(
      'SELECT * FROM users WHERE email = $1',
      ['test-e2e@test.com'],
    );

    if (users.length === 0) {
      const result = await dataSource.query<{ id: number }[]>(
        'INSERT INTO users (email, accountnumber) VALUES ($1, $2) RETURNING id',
        ['test-e2e@test.com', '9999999'],
      );
      testUserId = result[0].id;
    } else {
      testUserId = users[0].id;
    }

    // Ensure we have ARS instrument
    const arsInstruments = await dataSource.query<
      { id: number; ticker: string }[]
    >('SELECT * FROM instruments WHERE ticker = $1', ['ARS']);

    if (arsInstruments.length === 0) {
      const result = await dataSource.query<{ id: number }[]>(
        'INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, $3) RETURNING id',
        ['ARS', 'Peso Argentino', 'MONEDA'],
      );
      testArsId = result[0].id;
    } else {
      testArsId = arsInstruments[0].id;
    }

    // Ensure we have AAPL instrument
    const aaplInstruments = await dataSource.query<
      { id: number; ticker: string }[]
    >('SELECT * FROM instruments WHERE ticker = $1', ['AAPL']);

    if (aaplInstruments.length === 0) {
      const result = await dataSource.query<{ id: number }[]>(
        'INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, $3) RETURNING id',
        ['AAPL', 'Apple Inc.', 'ACCIONES'],
      );
      testAaplId = result[0].id;
    } else {
      testAaplId = aaplInstruments[0].id;
    }

    // Set up initial market data - this needs to be persistent
    await dataSource.query('DELETE FROM marketdata WHERE instrumentid = $1', [
      testAaplId,
    ]);
    await dataSource.query(
      'INSERT INTO marketdata (instrumentid, date, open, high, low, close, previousclose) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)',
      [testAaplId, 150, 155, 149, 153, 150],
    );
  });

  afterAll(async () => {
    // Clean up test data
    await dataSource.query('DELETE FROM orders WHERE userid = $1', [
      testUserId,
    ]);
    await dataSource.query('DELETE FROM balances WHERE userid = $1', [
      testUserId,
    ]);
    await dataSource.query('DELETE FROM marketdata WHERE instrumentid = $1', [
      testAaplId,
    ]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [testUserId]);

    await app.close();
  });

  beforeEach(async () => {
    // Clean any existing test data for this user
    await dataSource.query('DELETE FROM orders WHERE userid = $1', [
      testUserId,
    ]);
    await dataSource.query('DELETE FROM balances WHERE userid = $1', [
      testUserId,
    ]);

    // Set up initial balance for the user (10000 ARS and 50 AAPL shares)
    await dataSource.query(
      'INSERT INTO balances (userid, instrumentid, quantity, reserved) VALUES ($1, $2, $3, $4)',
      [testUserId, testArsId, 10000, 0],
    );

    await dataSource.query(
      'INSERT INTO balances (userid, instrumentid, quantity, reserved) VALUES ($1, $2, $3, $4)',
      [testUserId, testAaplId, 50, 0],
    );
  });

  afterEach(async () => {
    // Clean up orders and balances after each test
    await dataSource.query('DELETE FROM orders WHERE userid = $1', [
      testUserId,
    ]);
    await dataSource.query('DELETE FROM balances WHERE userid = $1', [
      testUserId,
    ]);
  });

  describe('POST /orders', () => {
    describe('Market Orders', () => {
      it('should create a MARKET BUY order and update balances', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 10,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
        });

        // Cash out order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 1500,
          price: '1.00',
          type: OrderType.MARKET,
          side: OrderSide.CASH_OUT,
          status: OrderStatus.FILLED,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(8500); // 10000 - 1500
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // MARKET orders should update balance immediately when FILLED
        expect(Number(aaplBalance.quantity)).toBe(60); // 50 + 10
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should create a MARKET SELL order and update balances', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5,
          type: OrderType.MARKET,
          side: OrderSide.SELL,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          status: OrderStatus.FILLED,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main sell order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 5,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          status: OrderStatus.FILLED,
        });

        // Cash in order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 750,
          price: '1.00',
          type: OrderType.MARKET,
          side: OrderSide.CASH_IN,
          status: OrderStatus.FILLED,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(10750); // 10000 + 750

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // MARKET orders should update balance immediately when FILLED
        expect(Number(aaplBalance.quantity)).toBe(45); // 50 - 5
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should reject a MARKET BUY order when insufficient funds', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 100, // 100 * 150 = 15000, but user only has 10000
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response - should be rejected
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 100,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.REJECTED,
        });

        // Verify database state - only one rejected order
        const orders = await dataSource.query<{ status: string }[]>(
          'SELECT * FROM orders WHERE userid = $1',
          [testUserId],
        );

        expect(orders).toHaveLength(1);
        expect(orders[0]?.status).toBe(OrderStatus.REJECTED);

        // Verify balances haven't changed
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(10000);
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        expect(Number(aaplBalance.quantity)).toBe(50);
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should reject a MARKET SELL order when insufficient shares', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 100, // User only has 50 shares
          type: OrderType.MARKET,
          side: OrderSide.SELL,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response - should be rejected
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 100,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          status: OrderStatus.REJECTED,
        });

        // Verify database state - only one rejected order
        const orders = await dataSource.query<{ status: string }[]>(
          'SELECT * FROM orders WHERE userid = $1',
          [testUserId],
        );

        expect(orders).toHaveLength(1);
        expect(orders[0]?.status).toBe(OrderStatus.REJECTED);

        // Verify balances haven't changed
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(10000);
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        expect(Number(aaplBalance.quantity)).toBe(50);
        expect(Number(aaplBalance.reserved)).toBe(0);
      });
    });

    describe('Limit Orders', () => {
      it('should create a LIMIT BUY order with NEW status and reserve funds', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10,
          price: 145,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10,
          price: 145,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
          status: OrderStatus.NEW,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 10,
          price: '145.00',
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
          status: OrderStatus.NEW,
        });

        // Cash out order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 1450,
          price: '1.00',
          type: OrderType.LIMIT,
          side: OrderSide.CASH_OUT,
          status: OrderStatus.NEW,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(8550); // 10000 - 1450
        expect(Number(arsBalance.reserved)).toBe(1450); // Reserved for the order

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // aapl balance is not yet reflected
        expect(Number(aaplBalance.quantity)).toBe(50);
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should create a LIMIT SELL order with NEW status and reserve shares', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5,
          price: 155,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5,
          price: 155,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 5,
          price: '155.00',
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
        });

        // Cash in order for LIMIT SELL
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 775, // 5 * 155 = 775
          price: '1.00',
          type: OrderType.LIMIT,
          side: OrderSide.CASH_IN,
          status: OrderStatus.NEW,
        });

        // Verify balances haven't changed for ARS (no cash in yet for LIMIT orders)
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(10000);
        expect(Number(arsBalance.reserved)).toBe(0);

        // Verify balances have changed for AAPL (shares are reserved)
        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        expect(Number(aaplBalance.quantity)).toBe(45); // 50 - 5
        expect(Number(aaplBalance.reserved)).toBe(5);
      });
    });

    describe('Total Amount Calculation', () => {
      it('should calculate size from totalAmount for MARKET orders', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          totalAmount: 1500, // Should buy 10 shares at 150 each
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10, // 1500 / 150 = 10
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 10,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.BUY,
          status: OrderStatus.FILLED,
        });

        // Cash out order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 1500,
          price: '1.00',
          type: OrderType.MARKET,
          side: OrderSide.CASH_OUT,
          status: OrderStatus.FILLED,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(8500); // 10000 - 1500
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // MARKET orders should update balance immediately when FILLED
        expect(Number(aaplBalance.quantity)).toBe(60); // 50 + 10
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should calculate size from totalAmount for LIMIT orders', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          totalAmount: 1450, // Should buy 10 shares at 145 each
          price: 145,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10, // 1450 / 145 = 10
          price: 145,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
          status: OrderStatus.NEW,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 10, // 1450 / 145 = 10
          price: '145.00',
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
          status: OrderStatus.NEW,
        });

        // Cash out order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 1450,
          price: '1.00',
          type: OrderType.LIMIT,
          side: OrderSide.CASH_OUT,
          status: OrderStatus.NEW,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(8550); // 10000 - 1450
        expect(Number(arsBalance.reserved)).toBe(1450);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // don't have the shares yet
        expect(Number(aaplBalance.quantity)).toBe(50);
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should calculate size from totalAmount for MARKET SELL orders', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          totalAmount: 750, // Should sell 5 shares at 150 each
          type: OrderType.MARKET,
          side: OrderSide.SELL,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5, // 750 / 150 = 5
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          status: OrderStatus.FILLED,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 5,
          price: '150.00',
          type: OrderType.MARKET,
          side: OrderSide.SELL,
          status: OrderStatus.FILLED,
        });

        // Cash in order
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 750,
          price: '1.00',
          type: OrderType.MARKET,
          side: OrderSide.CASH_IN,
          status: OrderStatus.FILLED,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        expect(Number(arsBalance.quantity)).toBe(10750); // 10000 + 750
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // MARKET orders should update balance immediately when FILLED
        expect(Number(aaplBalance.quantity)).toBe(45); // 50 - 5
        expect(Number(aaplBalance.reserved)).toBe(0);
      });

      it('should calculate size from totalAmount for LIMIT SELL orders', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          totalAmount: 775, // Should sell 5 shares at 155 each
          price: 155,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        // Verify response
        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5, // 775 / 155 = 5
          price: 155,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
        });

        // Verify database state - orders
        const orders = await dataSource.query<any[]>(
          'SELECT * FROM orders WHERE userid = $1 ORDER BY datetime DESC',
          [testUserId],
        );

        expect(orders).toHaveLength(2);

        // Main order
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 5, // 775 / 155 = 5
          price: '155.00',
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
          status: OrderStatus.NEW,
        });

        // Cash in order for LIMIT SELL
        expect(orders[1]).toMatchObject({
          userid: testUserId,
          instrumentid: testArsId,
          size: 775, // 5 * 155 = 775
          price: '1.00',
          type: OrderType.LIMIT,
          side: OrderSide.CASH_IN,
          status: OrderStatus.NEW,
        });

        // Verify database state - balances
        const [arsBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testArsId,
        ]);

        // ARS balance unchanged for LIMIT SELL
        expect(Number(arsBalance.quantity)).toBe(10000);
        expect(Number(arsBalance.reserved)).toBe(0);

        const [aaplBalance] = await dataSource.query<
          { quantity: string; reserved: string }[]
        >('SELECT * FROM balances WHERE userid = $1 AND instrumentid = $2', [
          testUserId,
          testAaplId,
        ]);

        // Shares are reserved for LIMIT SELL
        expect(Number(aaplBalance.quantity)).toBe(45); // 50 - 5
        expect(Number(aaplBalance.reserved)).toBe(5); // 5 shares reserved
      });
    });

    describe('Validation Errors', () => {
      it('should return 400 when userId is missing', async () => {
        const createOrderDto = {
          instrumentId: testAaplId,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(400);
      });

      it('should return 400 when neither size nor totalAmount is provided', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(400);
      });

      it('should return 400 when trying to buy or sell ARS (not cash operations)', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testArsId,
          size: 100,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(400);
      });

      it('should allow CASH_IN orders for ARS', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testArsId,
          size: 1000,
          price: 1,
          type: OrderType.MARKET,
          side: OrderSide.CASH_IN,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto);

        if (response.status !== 201) {
          console.log('CASH_IN error:', response.status, response.body);
        }

        expect(response.status).toBe(201);

        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testArsId,
          size: 1000,
          price: 1,
          type: OrderType.MARKET,
          side: OrderSide.CASH_IN,
          status: OrderStatus.FILLED,
        });
      });

      it('should allow CASH_OUT orders for ARS', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testArsId,
          size: 500,
          price: 1,
          type: OrderType.MARKET,
          side: OrderSide.CASH_OUT,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        expect(response.body).toMatchObject({
          userId: testUserId,
          instrumentId: testArsId,
          size: 500,
          price: 1,
          type: OrderType.MARKET,
          side: OrderSide.CASH_OUT,
          status: OrderStatus.FILLED,
        });
      });

      it('should return 404 when user does not exist', async () => {
        const createOrderDto = {
          userId: 99999,
          instrumentId: testAaplId,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(404);
      });

      it('should return 404 when instrument does not exist', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: 99999,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(404);
      });

      it('should return 400 when price is missing for LIMIT order', async () => {
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 10,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(400);
      });

      it('should return 400 when no market data is available', async () => {
        // Create a new instrument without market data
        const [newInstrument] = await dataSource.query<{ id: number }[]>(
          'INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, $3) RETURNING id',
          ['TSLA', 'Tesla Inc.', 'ACCIONES'],
        );

        const createOrderDto = {
          userId: testUserId,
          instrumentId: newInstrument.id,
          size: 10,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const response = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto);

        expect(response.status).toBe(400);

        // Clean up
        await dataSource.query('DELETE FROM instruments WHERE id = $1', [
          newInstrument.id,
        ]);
      });
    });

    describe('POST /orders/:id/cancel', () => {
      it('should cancel a LIMIT BUY order and rollback reserved balance', async () => {
        // First create a LIMIT BUY order
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 5,
          price: 145,
          type: OrderType.LIMIT,
          side: OrderSide.BUY,
        };

        const createResponse = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        expect((createResponse.body as OrderResponse).status).toBe(
          OrderStatus.NEW,
        );
        const orderId = (createResponse.body as OrderResponse).id;

        // Check that balance was reserved
        const balanceAfterOrder = await dataSource.query<
          { quantity: string; reserved: string }[]
        >(
          'SELECT quantity, reserved FROM balances WHERE userid = $1 AND instrumentid = $2',
          [testUserId, testArsId],
        );
        expect(Number(balanceAfterOrder[0].reserved)).toBeGreaterThan(0);

        // Cancel the order
        const cancelResponse = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .expect(200);

        expect((cancelResponse.body as OrderResponse).status).toBe(
          OrderStatus.CANCELLED,
        );

        // Verify balance was restored
        const balanceAfterCancel = await dataSource.query<
          { quantity: string; reserved: string }[]
        >(
          'SELECT quantity, reserved FROM balances WHERE userid = $1 AND instrumentid = $2',
          [testUserId, testArsId],
        );
        expect(Number(balanceAfterCancel[0].reserved)).toBe(0);
        expect(Number(balanceAfterCancel[0].quantity)).toBe(10000);
      });

      it('should cancel a LIMIT SELL order without affecting balance', async () => {
        // First create a LIMIT SELL order
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 3,
          price: 155,
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
        };

        const createResponse = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        expect((createResponse.body as OrderResponse).status).toBe(
          OrderStatus.NEW,
        );
        const orderId = (createResponse.body as OrderResponse).id;

        // Get balance before cancellation
        const balanceBeforeCancel = await dataSource.query<
          { quantity: string; reserved: string }[]
        >(
          'SELECT quantity, reserved FROM balances WHERE userid = $1 AND instrumentid = $2',
          [testUserId, testArsId],
        );

        // Cancel the order
        const cancelResponse = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .expect(200);

        expect((cancelResponse.body as OrderResponse).status).toBe(
          OrderStatus.CANCELLED,
        );

        // Verify balance unchanged
        const balanceAfterCancel = await dataSource.query<
          { quantity: string; reserved: string }[]
        >(
          'SELECT quantity, reserved FROM balances WHERE userid = $1 AND instrumentid = $2',
          [testUserId, testArsId],
        );
        expect(balanceAfterCancel[0].quantity).toBe(
          balanceBeforeCancel[0].quantity,
        );
        expect(balanceAfterCancel[0].reserved).toBe(
          balanceBeforeCancel[0].reserved,
        );
      });

      it('should return 400 when trying to cancel FILLED order', async () => {
        // First create a MARKET order (gets FILLED immediately)
        const createOrderDto = {
          userId: testUserId,
          instrumentId: testAaplId,
          size: 2,
          type: OrderType.MARKET,
          side: OrderSide.BUY,
        };

        const createResponse = await request(app.getHttpServer())
          .post('/orders')
          .send(createOrderDto)
          .expect(201);

        expect((createResponse.body as OrderResponse).status).toBe(
          OrderStatus.FILLED,
        );
        const orderId = (createResponse.body as OrderResponse).id;

        // Try to cancel the filled order
        const cancelResponse = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .expect(400);

        expect((cancelResponse.body as ErrorResponse).message).toContain(
          'Only orders with status NEW can be cancelled',
        );
      });

      it('should return 404 when trying to cancel non-existent order', async () => {
        await request(app.getHttpServer())
          .post('/orders/99999/cancel')
          .expect(404);
      });
    });
  });
});
