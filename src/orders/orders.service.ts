import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
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
    const { userId, instrumentId, type, side, size, price, totalAmount } =
      createOrderDto;

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

    if (!size && !totalAmount) {
      throw new BadRequestException('Size or total amount needed');
    }

    if (type === OrderType.LIMIT) {
      if (!price) {
        throw new BadRequestException('Price is required for LIMIT orders');
      }

      const computedSize =
        // tengo que castear a number porque ts no entiende que size es undefined totalAmount no puede serlo.
        size ?? Math.floor((totalAmount as number) / price);

      if (side === OrderSide.BUY) {
        // 1. verificar que el usuario tiene la cantidad de fondos necesarios computedSize * price. acá tengo que usar la tabla consolidada
        // 2. si no tiene fondos suficientes es REJECTED
        // 3. crear un cash_out de cantidad de pesos price 1 y size = computedSize * price
        // 4. descontarle de la tabla consolidada computedSize * price
        // 5. crear el row en orders de buy del instrumento con price, computed size en estado new
      } else {
        // 1. verificar que tiene la cantidad de acciones para vender
        // 2. si no las tiene es un REJECTED
        // 3. como estan ordenes quedan en NEW no va a haber un cash_in de pesos eso va a ser parte del proceso async
        // 4. tampoco va a haber un update en la tabla consolidada.
        // 5. se va a crear el row en orders de sell del instrumento con price, computed size en estado new
      }
    } else {
      // tipo market

      // usando el price del market

      if (side === OrderSide.BUY) {
        // 1. verificar que el usuario tiene la cantidad de fondos necesarios computedSize * price. acá tengo que usar la tabla consolidada
        // 2. si no tiene fondos suficientes es REJECTED
        // 3. crear un cash_out de cantidad de pesos price 1 y size = computedSize * price
        // 4. descontarle de la tabla consolidada computedSize * price
        // 5. crear el row en orders de buy del instrumento con price, computed size en estado FILLED
      } else {
        // 1. verificar que tiene la cantidad de acciones para vender
        // 2. si no las tiene es un REJECTED
        // 3. hacer un cash in de pesos en la tabla ordenes por el monto de la venta
        // 4. aumentar esa cantidad en la tabla consolidad.
        // 5. se va a crear el row en orders de sell del instrumento con price, computed size en estado FILLED
      }
    }

    const instrumentPrice = await this.getInstrumentPrice(
      instrumentId,
      type,
      price,
    );

    if (totalAmount && !size) {
      // size = Math.floor(totalAmount / instrumentPrice);
      if (size === 0) {
        throw new BadRequestException(
          'Total amount is too small to buy at least one share',
        );
      }
    }

    if (!size || size <= 0) {
      throw new BadRequestException('Order size must be greater than 0');
    }

    const totalCost = size * instrumentPrice;

    const validation = await this.validateOrder(
      userId,
      instrumentId,
      side,
      size,
      totalCost,
    );
    if (!validation.isValid) {
      const order = this.orderRepository.create({
        userId,
        instrumentId,
        side,
        size,
        price: instrumentPrice,
        type,
        status: OrderStatus.REJECTED,
        datetime: new Date(),
      });
      return await this.orderRepository.save(order);
    }

    let status: OrderStatus;
    if (type === OrderType.MARKET) {
      status = OrderStatus.FILLED;
    } else {
      status = OrderStatus.NEW;
    }

    const order = this.orderRepository.create({
      userId,
      instrumentId,
      side,
      size,
      price: instrumentPrice,
      type,
      status,
      datetime: new Date(),
    });

    const savedOrder = await this.orderRepository.save(order);

    if (status === OrderStatus.FILLED) {
      // await this.updateUserPosition(
      //   userId,
      //   instrumentId,
      //   side,
      //   size,
      //   orderPrice,
      // );
    }

    return savedOrder;
  }

  async getInstrumentPrice(
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

  async cancelOrder(orderId: number): Promise<Order> {
    const order = await this.orderRepository.findOne({
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

    order.status = OrderStatus.CANCELLED;
    return await this.orderRepository.save(order);
  }

  async getOrdersByUser(userId: number): Promise<Order[]> {
    return await this.orderRepository.find({
      where: { userId },
      relations: ['instrument'],
      order: { datetime: 'DESC' },
    });
  }

  private async getLatestMarketData(
    instrumentId: number,
  ): Promise<MarketData | null> {
    return await this.marketDataRepository.findOne({
      where: { instrumentId },
      order: { date: 'DESC' },
    });
  }

  private async validateOrder(
    userId: number,
    instrumentId: number,
    side: OrderSide,
    size: number,
    totalCost: number,
  ): Promise<{ isValid: boolean; reason?: string }> {
    if (side === OrderSide.BUY) {
      const availableCash = await this.getUserAvailableCash(userId);
      if (availableCash < totalCost) {
        return { isValid: false, reason: 'Insufficient funds' };
      }
    } else if (side === OrderSide.SELL) {
      const availableShares = await this.getUserAvailableShares(
        userId,
        instrumentId,
      );
      if (availableShares < size) {
        return { isValid: false, reason: 'Insufficient shares' };
      }
    }

    return { isValid: true };
  }

  private async getUserAvailableCash(userId: number): Promise<number> {
    const cashInstrument = await this.instrumentRepository.findOne({
      where: { ticker: 'ARS', type: 'MONEDA' },
    });

    if (!cashInstrument) {
      throw new Error('Cash instrument not found');
    }

    const orders = await this.orderRepository.find({
      where: { userId, status: OrderStatus.FILLED },
    });

    let totalCash = 0;

    for (const order of orders) {
      const orderPrice = Number(order.price) || 1;
      if (order.side === OrderSide.CASH_IN) {
        totalCash += order.size * orderPrice;
      } else if (order.side === OrderSide.CASH_OUT) {
        totalCash -= order.size * orderPrice;
      } else if (order.side === OrderSide.BUY) {
        totalCash -= order.size * orderPrice;
      } else if (order.side === OrderSide.SELL) {
        totalCash += order.size * orderPrice;
      }
    }

    return totalCash;
  }

  private async getUserAvailableShares(
    userId: number,
    instrumentId: number,
  ): Promise<number> {
    const orders = await this.orderRepository.find({
      where: { userId, instrumentId, status: OrderStatus.FILLED },
    });

    let totalShares = 0;

    for (const order of orders) {
      if (order.side === OrderSide.BUY) {
        totalShares += order.size;
      } else if (order.side === OrderSide.SELL) {
        totalShares -= order.size;
      }
    }

    return totalShares;
  }

  // private async updateUserPosition(
  //   userId: number,
  //   instrumentId: number,
  //   side: OrderSide,
  //   size: number,
  //   price: number,
  // ): Promise<void> {
  //   console.log(
  //     `Position updated for user ${userId}: ${side} ${size} shares of instrument ${instrumentId} at ${price}`,
  //   );
  // }
}
