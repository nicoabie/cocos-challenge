import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { OrderSide, OrderStatus, OrderType } from '../src/orders/order.entity';

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
        ['test-e2e@test.com', '10002'],
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
      });

      it('should create a LIMIT SELL order with NEW status', async () => {
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
          'SELECT * FROM orders WHERE userid = $1',
          [testUserId],
        );

        expect(orders).toHaveLength(1);
        expect(orders[0]).toMatchObject({
          userid: testUserId,
          instrumentid: testAaplId,
          size: 5,
          price: '155.00',
          type: OrderType.LIMIT,
          side: OrderSide.SELL,
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

      it('should return 400 when trying to buy or sell ARS', async () => {
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
  });
});
