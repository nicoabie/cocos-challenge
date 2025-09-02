import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { User } from '../users/user.entity';
import { Instrument } from '../instruments/instrument.entity';
import { MarketData } from '../marketdata/marketdata.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { Balance } from 'src/balances/balance.entity';

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
    @InjectRepository(Balance)
    private balancesRepository: Repository<Balance>,
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

    const instrumentPrice = await this.getInstrumentPrice(
      instrumentId,
      type,
      userDefinedPrice,
    );

    const arsIinstrument = await this.instrumentRepository.findOne({
      where: { ticker: 'ARS' },
    });
    if (!arsIinstrument) {
      throw new NotFoundException(`ARS Instrument not found`);
    }

    if (arsIinstrument.id === instrument.id) {
      // esto no estaba literal en el enunciado pero tiene sentido dada la consigna
      // solo se compran y venden acciones
      throw new BadRequestException('Cannot buy or sell ARS');
    }

    const computedSize =
      // tengo que castear a number porque ts no entiende que size es undefined userDefinedAmount no puede serlo.
      userDefinedSize ??
      Math.floor((userDefinedAmount as number) / instrumentPrice);

    const orderTotal = instrumentPrice * computedSize;

    return await this.dataSource.transaction(async (manager) => {
      const orderRepository = manager.getRepository(Order);

      if (side === OrderSide.BUY) {
        const res = await manager.query<{ available: string }[]>(
          `SELECT quantity - reserved AS available FROM balances WHERE userid = $1 AND instrumentid = $2 FOR UPDATE`,
          [userId, arsIinstrument.id],
        );

        const arsAvailable = !res[0] ? 0 : Number(res[0].available);

        if (arsAvailable < orderTotal) {
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
        if (status === OrderStatus.NEW) {
          await manager.query(
            'UPDATE balances SET reserved = reserved + $1 WHERE userid = $2 AND instrumentid = $3',
            [orderTotal, userId, arsIinstrument.id],
          );
        }
        return order;
      } else {
        // TODO: hacer switch así queda claro que caso es.
        // venta
        const res = await manager.query<{ available: string }[]>(
          `SELECT quantity - reserved AS available FROM balances WHERE userid = $1 AND instrumentid = $2 FOR UPDATE`,
          [userId, instrument.id],
        );

        const actionAvailable = !res[0] ? 0 : Number(res[0].available);
        // TODO el mecanismo de reject se puede extraer
        if (computedSize > actionAvailable) {
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

        if (status === OrderStatus.FILLED) {
          await orderRepository.save({
            userId,
            instrumentId: arsIinstrument.id,
            price: 1,
            size: orderTotal,
            side: OrderSide.CASH_IN,
            status,
            type,
          });

          await manager.query(
            'UPDATE balances SET quantity = quantity + $1 WHERE userid = $2 AND instrumentid = $3',
            [orderTotal, userId, arsIinstrument.id],
          );
        }

        return order;
      }
    });

    /*
    if (type === OrderType.LIMIT) {
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
    */
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
