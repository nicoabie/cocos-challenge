import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderSide, OrderStatus } from '../orders/order.entity';
import { PortfolioDto } from './dto/portfolio.dto';
import { Balance } from './balance.entity';

const ARS_TICKER = 'ARS';

// cree este balances service porque no me pareció buena la forma que tiene typeorm de resolver los custom repositories
// https://typeorm.io/docs/working-with-entity-manager/custom-repository/#using-custom-repositories-in-transactions
// donde uno le tiene explicitamente declarar que use el repositorio que uno extendió. `manager.withRepository(UserRepository)`

@Injectable()
export class BalancesService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Balance)
    private balancesRepository: Repository<Balance>,
  ) {}

  getUserTickerAvailabilityBaseQuery(userId: number, ticker: string) {
    return this.balancesRepository
      .createQueryBuilder('balance')
      .innerJoin('balance.instrument', 'instrument')
      .where('balance.userId = :userId', { userId })
      .andWhere('instrument.ticker = :ticker', { ticker });
    // por alguna razón no puedo llamar a setLock si no estoy dentro de una transacction.
    // lo cual no sé si tiene mucho sentido dado que en el motor de base de datos puedo hacer
    // un select for update sin una y sin problemas.
    // así que expongo este método para en order service poder llamar a setLock...
    // .setLock('pessimistic_write')
  }

  async getUserTickerAvailability(
    userId: number,
    ticker: string,
  ): Promise<number> {
    const balance = await this.getUserTickerAvailabilityBaseQuery(
      userId,
      ticker,
    )
      .select()
      .getOne();

    return !balance ? 0 : balance.quantity - balance.reserved;
  }

  async getPortfolio(userId: number): Promise<PortfolioDto> {
    // hablando de ORMS a mí mucho no me convencen y hace un par de años empecé a hacer mi ORM en contra de otros, irónico, no?
    // https://github.com/agiletiger/ojotas hoy en día si tuviese que interactuar con postgres usaría https://pgtyped.dev/
    // aunque por lo que estuve leyendo typeorm es mejor que sequelize (que padeci bastante) y definitamente mejor que objection (definitivamente el peor que usé)

    // tengo que decirle que son strings para luego saber que tengo que transformarlos con Number porque typeorm los transforma a string, por eso me quejaba arriba :P
    // sino += me va a concatenar los strings :)
    const positionsQuery = this.ordersRepository.query<
      {
        name: string;
        ticker: string;
        // lo que realmente tenés invertido después de ventas.
        net_invested: string;
        // cuántas acciones te quedan.
        net_quantity: string;
        // tu costo promedio.
        avg_cost: string;
        // valor de mercado actual de esa posición.
        current_value: string;
        // rendimiento total (%) del activo.
        return_pct: string;
      }[]
    >(
      `
      WITH
	      buys AS (
	      	SELECT
	      		userid,
	      		instrumentid,
	      		SUM(price * size) AS total_invested,
	      		SUM(size) AS total_quantity
	      	FROM
	      		orders
	      	WHERE
	      		side = '${OrderSide.BUY}'
	      		AND status = '${OrderStatus.FILLED}'
            AND userid = $1
	      	GROUP BY
	      		userid,
	      		instrumentid
	      ),
	      sells AS (
	      	SELECT
	      		userid,
	      		instrumentid,
	      		SUM(price * size) AS total_sales,
	      		SUM(size) AS total_sold
	      	FROM
	      		orders
	      	WHERE
	      		side = '${OrderSide.SELL}'
	      		AND STATUS = '${OrderStatus.FILLED}'
            AND userid = $2
	      	GROUP BY
	      		userid,
	      		instrumentid
	      ),
	      last_price AS (
	      	SELECT DISTINCT
	      		ON (instrumentId) instrumentId,
	      		coalesce(
	      			CLOSE,
	      			previousclose
	      		) AS
	      	CLOSE
	      	FROM
	      		marketdata
	      	ORDER BY
	      		instrumentId,
	      		date DESC
	      )
      SELECT
      	instruments.id,
      	instruments.name,
      	instruments.ticker,
      	b.total_invested - COALESCE(s.total_sales, 0) AS net_invested,
      	b.total_quantity - COALESCE(s.total_sold, 0) AS net_quantity,
      	(b.total_invested / NULLIF(b.total_quantity, 0)) AS avg_cost,
      	((b.total_quantity - COALESCE(s.total_sold, 0)) * lp.close) AS current_value,
      	ROUND((((b.total_quantity - COALESCE(s.total_sold, 0)) * lp.close) - (b.total_invested - COALESCE(s.total_sales, 0))) / NULLIF((b.total_invested - COALESCE(s.total_sales, 0)), 0) * 100, 2) AS return_pct
      FROM
      	buys b
      	LEFT JOIN sells s ON b.userid = s.userid AND b.instrumentid = s.instrumentid
      	JOIN last_price lp ON lp.instrumentId = b.instrumentid
      	JOIN instruments on b.instrumentid = instruments.id;
      `,
      [userId, userId],
    );

    // es importante destacar que si bien tengo que obtener todas las posiciones, la parte heavy de la cuenta se hace en la base de datos.
    // esto es una decisión consciente dado que las bases de datos están optimizadas para ese tipo de trabajo y nodejs es single threaded.
    // si dedico mucho tiempo en atender una petición, eso hace que las demás requests deban esperar por como funciona el event loop.
    // he visto muchas veces donde se hace demasiado en el servidor cosas que la base de datos podría resolver. luego está monitorear la base de datos.

    // estas dos las puedo hacer de manera concurrente
    const [positions, ars] = await Promise.all([
      positionsQuery,
      this.getUserTickerAvailability(userId, ARS_TICKER),
    ]);

    const result: PortfolioDto = {
      availableCash: 0,
      positions: [],
      totalValue: 0,
    };

    // a alguna gente le pone mal cuando ve un for en vez de algo más funcional como map
    // pero en este caso yo necesito no solo hacer la transformación de lo que me retornó la base de datos
    // a el dto sino que también tengo que acumular para obetener totalValue y me gustaría recorrer solamente una vez la colección.

    // me podrían decir que puedo hacerlo con un reducer pero los reducer son bastante dificiles de entender luego de que uno los escribe
    // así que el buen for acá tiene mucho sentido.
    for (const position of positions) {
      result.totalValue += Number(position.current_value);
      result.positions.push({
        name: position.name,
        ticker: position.ticker,
        quantity: Number(position.net_quantity),
        totalValue: Number(position.current_value),
        performance: Number(position.return_pct),
      });
    }

    result.availableCash = ars;
    result.totalValue += ars;

    return result;
  }
}
