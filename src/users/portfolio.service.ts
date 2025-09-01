import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderSide, OrderStatus } from '../orders/order.entity';
import { PortfolioDto } from './dto/portfolio.dto';

const ARS_TICKER = 'ARS';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
  ) {}

  async getPortfolio(userId: number): Promise<PortfolioDto> {
    // si bien el resultado de esta query va a ser unico o ninguno dado que estoy buscando un instrumento en específico,
    // typeorm no tiene un método por lo que vi para hacer queryOne como otros ORMS

    // hablando de ORMS a mí mucho no me convencen y hace un par de años empecé a hacer mi ORM en contra de otros, irónico, no?
    // https://github.com/agiletiger/ojotas hoy en día si tuviese que interactuar con postgres usaría https://pgtyped.dev/

    // también en cierto que net_amount es en realidad del tipo number pero typeorm no sabe esto y lo devuelve como string...
    const arsQuery = this.ordersRepository.query<{ net_amount: string }[]>(
      `
      SELECT
	      sum(
	      	CASE
	      		WHEN side = '${OrderSide.CASH_IN}' THEN size * price
 	      		ELSE - size * price
	      	END
	      ) AS net_amount
        FROM
        	orders
        JOIN instruments on instrumentid = instruments.id
        WHERE
        	userid = $1
        	AND side IN ('${OrderSide.CASH_IN}', '${OrderSide.CASH_OUT}')
        	AND status = '${OrderStatus.FILLED}'
        	AND ticker = $2
        GROUP BY
        	instruments.id;
    `,
      [userId, ARS_TICKER],
    );

    // mismo pasa con el resultado de esta query, tengo que decirle que son strings para luego saber que tengo que transformarlos con Number
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
    const [positions, ars] = await Promise.all([positionsQuery, arsQuery]);

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

    if (ars[0]) {
      result.availableCash = Number(ars[0].net_amount);
      result.totalValue += Number(ars[0].net_amount);
    }

    return result;
  }
}
