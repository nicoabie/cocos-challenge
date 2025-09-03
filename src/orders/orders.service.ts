import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Instrument)
    private instrumentRepository: Repository<Instrument>,
    @InjectRepository(MarketData)
    private marketDataRepository: Repository<MarketData>,
  ) {}

  async createOrder(createOrderDto: CreateOrderDto): Promise<Order> {
    const {
      userId,
      instrumentId,
      type,
      side,
      size: userDefinedSize,
      price: userDefinedPrice,
      totalAmount: userDefinedAmount,
    } = createOrderDto;

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const instrument = await this.instrumentRepository.findOne({
      where: { id: instrumentId },
    });
    if (!instrument) {
      throw new NotFoundException(
        `Instrument with ID ${instrumentId} not found`,
      );
    }

    if (!userDefinedSize && !userDefinedAmount) {
      throw new BadRequestException('Size or total amount needed');
    }

    const arsIinstrument = await this.instrumentRepository.findOne({
      where: { ticker: 'ARS' },
    });
    if (!arsIinstrument) {
      throw new NotFoundException(`ARS Instrument not found`);
    }

    return await this.dataSource.transaction(async (manager) => {
      const orderRepository = manager.getRepository(Order);

      if (side === OrderSide.CASH_IN || side === OrderSide.CASH_OUT) {
        if (type !== OrderType.MARKET) {
          throw new BadRequestException(
            'CASH_IN / CASH_OUT orders must be of type MARKET',
          );
        }
        if (!userDefinedAmount) {
          throw new BadRequestException('Need an amount');
        }
        if (arsIinstrument.id === instrument.id) {
          if (side === OrderSide.CASH_IN) {
            await manager.query(
              'UPDATE balances SET quantity = quantity + $1 WHERE userid = $2 AND instrumentid = $3',
              [userDefinedAmount, userId, arsIinstrument.id],
            );
          }
          if (side === OrderSide.CASH_OUT) {
            const arsAvailable = await this.getInstrumentAvailability({
              userId,
              instrumentId: arsIinstrument.id,
              manager,
            });

            if (arsAvailable < userDefinedAmount) {
              throw new BadRequestException('Insufficient balance');
            }

            await manager.query(
              'UPDATE balances SET quantity = quantity - $1 WHERE userid = $2 AND instrumentid = $3',
              [userDefinedAmount, userId, arsIinstrument.id],
            );
          }
          return await orderRepository.save({
            userId,
            instrumentId,
            side,
            size: userDefinedAmount,
            price: 1,
            type,
            status: OrderStatus.FILLED,
          });
        } else {
          throw new BadRequestException('Only ARS can be CASHED_IN/CASHED_OUT');
        }
      }

      if (arsIinstrument.id === instrument.id) {
        // esto no estaba literal en el enunciado pero tiene sentido dada la consigna
        // solo se compran y venden acciones
        throw new BadRequestException('Cannot buy or sell ARS');
      }

      const instrumentPrice = await this.getInstrumentPrice(
        instrumentId,
        type,
        userDefinedPrice,
      );

      const computedSize =
        // tengo que castear a number porque ts no entiende que size es undefined userDefinedAmount no puede serlo.
        userDefinedSize ??
        Math.floor((userDefinedAmount as number) / instrumentPrice);

      const orderTotal = instrumentPrice * computedSize;

      const instrumentIdToDeductFrom = this.getInstrumentIdToDeductFrom({
        actionInstrumentId: instrumentId,
        arsInstrumentId: arsIinstrument.id,
        side,
      });

      const instrumentAvailability = await this.getInstrumentAvailability({
        userId,
        instrumentId: instrumentIdToDeductFrom,
        manager,
      });

      if (
        (side === OrderSide.BUY && instrumentAvailability < orderTotal) ||
        (side === OrderSide.SELL && computedSize > instrumentAvailability)
      ) {
        return await orderRepository.save({
          userId,
          instrumentId,
          side,
          size: computedSize,
          price: instrumentPrice,
          type,
          status: OrderStatus.REJECTED,
        });
      }

      if (side === OrderSide.BUY) {
        const status =
          type === OrderType.LIMIT ? OrderStatus.NEW : OrderStatus.FILLED;
        const order = await orderRepository.save({
          userId,
          instrumentId,
          price: instrumentPrice,
          size: computedSize,
          side,
          status,
          type,
        });
        await orderRepository.save({
          userId,
          instrumentId: arsIinstrument.id,
          price: 1,
          size: orderTotal,
          side: OrderSide.CASH_OUT,
          status,
          type,
        });
        await manager.query(
          'UPDATE balances SET quantity = quantity - $1 WHERE userid = $2 AND instrumentid = $3',
          [orderTotal, userId, arsIinstrument.id],
        );
        if (status === OrderStatus.FILLED) {
          await manager.query(
            'UPDATE balances SET quantity = quantity + $1 WHERE userid = $2 AND instrumentid = $3',
            [computedSize, userId, instrumentId],
          );
        }
        if (status === OrderStatus.NEW) {
          await manager.query(
            'UPDATE balances SET reserved = reserved + $1 WHERE userid = $2 AND instrumentid = $3',
            [orderTotal, userId, arsIinstrument.id],
          );
        }
        return order;
      } else {
        const status =
          type === OrderType.LIMIT ? OrderStatus.NEW : OrderStatus.FILLED;
        const order = await orderRepository.save({
          userId,
          instrumentId,
          price: instrumentPrice,
          size: computedSize,
          side,
          status,
          type,
        });
        await orderRepository.save({
          userId,
          instrumentId: arsIinstrument.id,
          price: 1,
          size: orderTotal,
          side: OrderSide.CASH_IN,
          status,
          type,
        });

        if (status === OrderStatus.FILLED) {
          await manager.query(
            'UPDATE balances SET quantity = quantity + $1 WHERE userid = $2 AND instrumentid = $3',
            [orderTotal, userId, arsIinstrument.id],
          );
          await manager.query(
            'UPDATE balances SET quantity = quantity - $1 WHERE userid = $2 AND instrumentid = $3',
            [computedSize, userId, instrumentId],
          );
        } else {
          // reservo la cantidad para no sobre vender
          await manager.query(
            'UPDATE balances SET quantity = quantity - $1, reserved = reserved + $1 WHERE userid = $2 AND instrumentid = $3',
            [computedSize, userId, instrumentId],
          );
        }

        return order;
      }
    });
  }

  async cancelOrder(orderId: number): Promise<Order> {
    return await this.dataSource.transaction(async (manager) => {
      const orderRepository = manager.getRepository(Order);
      const order = await orderRepository.findOne({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      if (order.status !== OrderStatus.NEW) {
        throw new BadRequestException(
          `Only orders with status NEW can be cancelled. Current status: ${order.status}`,
        );
      }

      // For BUY orders, we need to rollback the reserved funds
      if (order.side === OrderSide.BUY) {
        const arsIinstrument = await this.instrumentRepository.findOne({
          where: { ticker: 'ARS' },
        });
        if (!arsIinstrument) {
          throw new NotFoundException(`ARS Instrument not found`);
        }

        const orderTotal = order.price * order.size;

        // Rollback the balance changes: add back to quantity, reduce reserved
        await manager.query(
          'UPDATE balances SET quantity = quantity + $1, reserved = reserved - $1 WHERE userid = $2 AND instrumentid = $3',
          [orderTotal, order.userId, arsIinstrument.id],
        );
      }

      order.status = OrderStatus.CANCELLED;
      return await orderRepository.save(order);
    });
  }

  async getOrdersByUser(userId: number): Promise<Order[]> {
    return await this.orderRepository.find({
      where: { userId },
      relations: ['instrument'],
      order: { datetime: 'DESC' },
    });
  }

  private getInstrumentIdToDeductFrom({
    actionInstrumentId,
    arsInstrumentId,
    side,
  }: {
    actionInstrumentId: number;
    arsInstrumentId: number;
    side: OrderSide.BUY | OrderSide.SELL;
  }) {
    switch (side) {
      case OrderSide.BUY:
        return arsInstrumentId;
      case OrderSide.SELL:
        return actionInstrumentId;
      default: {
        const exhaustiveCheck: never = side;
        // este return no se va a ejecutar
        return exhaustiveCheck;
      }
    }
  }

  private async getInstrumentAvailability({
    userId,
    instrumentId,
    manager,
  }: {
    userId: number;
    instrumentId: number;
    manager: EntityManager;
  }): Promise<number> {
    const res = await manager.query<{ available: string }[]>(
      `SELECT quantity - reserved AS available FROM balances WHERE userid = $1 AND instrumentid = $2 FOR UPDATE`,
      [userId, instrumentId],
    );

    return !res[0] ? 0 : Number(res[0].available);
  }

  private async getInstrumentPrice(
    instrumentId: number,
    type: OrderType,
    userDefinedPrice: number | undefined,
  ): Promise<number> {
    switch (type) {
      case OrderType.MARKET: {
        const marketData = await this.getLatestMarketData(instrumentId);
        if (!marketData) {
          throw new BadRequestException(
            `No market data available for instrument ${instrumentId}`,
          );
        }
        return marketData.previousClose;
      }
      case OrderType.LIMIT: {
        if (!userDefinedPrice) {
          throw new BadRequestException('Price is required for LIMIT orders');
        }
        return userDefinedPrice;
      }
      default: {
        // de esta forma si agregásemos un nuevo order type, el typesystem nos daría un error.
        // para cosas más complejas he utilizado https://github.com/gvergnaud/ts-pattern
        const exhaustiveCheck: never = type;
        // este return no se va a ejecutar
        return exhaustiveCheck;
      }
    }
  }

  private async getLatestMarketData(
    instrumentId: number,
  ): Promise<MarketData | null> {
    return await this.marketDataRepository.findOne({
      where: { instrumentId },
      order: { date: 'DESC' },
    });
  }
}
