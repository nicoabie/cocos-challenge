-- market data
--------------

-- este indice es para que sea más sencillo encontrar el ultimo close de cada instrumento para calcular el rendimiento
-- también se podría matarializar esto en una vista (si vamos a hacer los calculos en la DB) o en un redis si vamos a hacer 
-- los calculos en la APP y tiene más sentido mantener eso para otros calculos o bien para mostrarle al usuario esos datos o bien 
-- una agregación de los mismo sin tener la necesidad de consultar la base de datos.

-- pensandolo un poco mejor, hasta díria que en vez de materializarlo en una vista tendría una tabla separada "instrument_last_close" que solo tenga
-- id del instrumento y su close (ambos NOT null), y todos los días cuando arranca y cierra el mercado hacer un upsert
-- esto se haría con una transacción al insertar en marketdata
CREATE INDEX idx_marketdata_instrument_date 
    ON marketdata (instrumentId, date DESC);

-- siguiendo hablando sobre market data, creo que está bien que tenga la columna previous close en cada row porque cuando uno consulta
-- la información desde la UI está bueno tener todos esos datos juntos y no quisiera tener que hacer otra consulta.
-- lo que sí veo es que tiene demasiado campos en null, una mejor difinición sería la siguiente:

CREATE TABLE marketdata (
  id SERIAL PRIMARY KEY,
  instrumentId INT NOT NULL, -- no solo tenemos una foreign key sino que no tendría sentido para el negocio marketdata que no estuviese asociada a ningún instrumento
  high NUMERIC(10, 2) NOT NULL, -- cuando arranca la jornada, open, high, low tienen el mismo valor
  -- luego high y low van variando hasta que termina la jornada y se hace close.
  low NUMERIC(10, 2) NOT NULL,
  open NUMERIC(10, 2) NOT NULL,
  close NUMERIC(10, 2), -- este durante la jornada sí, es null
  previousClose NUMERIC(10, 2) NOT NULL, -- acá estoy asumiendo algo interesante y es que siempre hay un previousClose
  -- la pregunta es que pasa cuando un instrumento se crea por primera vez, imaginemos que creamos la cripto moneda de franco colapinto :P
  -- yo pienso/tengo entendido que inicialmente se pacta un valor cuando algo sale a la bolsa. por eso digo que previousClose podría ser NOT NULL
  date DATE NOT NULL, -- importante saber a qué día corresponde, no puede ser null
  FOREIGN KEY (instrumentId) REFERENCES instruments(id)
);

-- algo bastante interesante es que marketdata no tiene el valor actual del instrumento, 
-- por lo que para los compras se va a utilizar el previousClose que siempre está presente.

-- instruments 
--------------

-- el problema con esta tabla es usar varchar de 10 como tipo de dato para la columna type que es un enum ACCION | MONEDA
-- el ticker de 10 y el name de 255 puede estar bien pero ambos deberían ser not null

-- una decinición más acertada sería la siguiente, esto nos asegura que siempre la tabla va a contener valores con sentido.
CREATE TABLE instruments (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL ,
  type VARCHAR(10) CHECK (type IN ('ACCION', 'MONEDA')) NOT NULL
);

-- acá la verdad es que no son muchos activos y los campos de nombre y ticker
-- no son ni largos ni el tipo de busquedas van a ser muy complejas

-- no veo que tenga sentido agregar un indice para soportar full text search
-- https://www.postgresql.org/docs/current/textsearch-indexes.html

-- habría que ver métricas de cuantas búsquedas se hacen de activos, lo cierto es que hasta se podrían cachear dado que no cambian
-- mismo en el proceso de backend dado que no son muchos o en un redis si ya se tuviese alguno (si por alguna razón no se quisiera mantener estado en el proceso de backend)

-- pero al menos lo que podemos hacer es crear un indice único por ticker, porque no deberia haber repetidos

ALTER TABLE instruments
ADD CONSTRAINT instruments_ticker_unique UNIQUE (ticker);


-- orders
---------

-- la tabla de orders está bien como un registro histórico de lo que fue aconteciendo. 
-- el problema que tenemos es que no hay un consolidado, de las posiciones de las acciones tanto como de los pesos.
-- entonces no tenemos forma de asegurar cuando queremos vender un activo que realmente tenemos ese activo o si queremos
-- comprar un activo que efectivamente tenemos los pesos. La manera de hacer eso es con SELECT FOR UPDATE que va a lockear
-- la fila durante la transacción y eso va a evitar que algo se deduzca dos veces por ejemplo (si hay más de una transacción en curso)

-- a la tabla de ordenes le podemos agregar un par de checks
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  instrumentId INT NOT NULL,
  userId INT NOT NULL,
  size INT CHECK (size > 0) NOT NULL,
  price NUMERIC(10, 2) CHECK (price > 0) NOT NULL,
  type VARCHAR(10) CHECK (type IN ('MARKET', 'LIMIT')) NOT NULL,
  side VARCHAR(10) CHECK (type IN ('BULL', 'SELL', 'CASH_IN', 'CASH_OUT')) NOT NULL,
  status VARCHAR(20) CHECK (type IN ('NEW', 'FILLED', 'REJECTED', 'CANCELLED')) NOT NULL,
  datetime TIMESTAMP DEFAULT NOW() NOT NULL,
  FOREIGN KEY (instrumentId) REFERENCES instruments(id),
  FOREIGN KEY (userId) REFERENCES users(id)
);

-- ahí quedó más bonita y nos aseguramenos que no acepte valores incorectos. muchas veces se utilizan diversos sistemas con una misma
-- base de datos, es siempre importante que el modelo de datos proteja de estados no validos. 
-- en sistemas en los cuales hay muchísimos inserts por segundo se quitan los foreign keys porque están implementados como triggers
-- y cada vez que se inserta una row el motor de base de datos feacientemente verifica que exista la relación, lo cual lo torna lento.
-- entonces lo que se hace es asegurarse a nivel de applicación. nada, comentario. ya que estaba charlando un poco de estados validos.

-- bueno, volviendo al consolidado, necesitamos una tabla de balances 

-- tadah!!
CREATE TABLE balances (
  userId INT NOT NULL,
  instrumentId INT NOT NULL, -- incluye acciones y ARS
  quantity NUMERIC(18,2) CHECK (quantity >= 0) NOT NULL DEFAULT 0,
  reserved NUMERIC(18,2) CHECK (reserved >= 0) NOT NULL DEFAULT 0, -- saldo bloqueado por órdenes NEW
  PRIMARY KEY (userId, instrumentId)
);

-- me pareció buena idea tener un reserved que la sumatoria de todas las órdenes NEW para ese instrumento.
-- de esta manera te queda siempre que quantity + reserved = FILLED + NEW
-- y evita poder sobre vender acciones o sobre usar pesos para comprar acciones.

-- ahora necesitamos llenarla, con la información de ordernes que tenemos. pero si observamos la tabla de ordenes no está completa
-- le falta las contra partidas de los BUY y los SALE. todas las operaciones se hacen contra el instrumento pesos entonces
-- tiene sentido que cuando se hace una compra de una accion haya un cash out de pesos y cuando se haga una venta de una accion 
-- haya un cash in de pesos. así te queda como un double entry ledger y esto nos va a permitir generar la tabla de balances.

INSERT INTO orders (instrumentId, userId, size, price, side, type, status, datetime)
SELECT
	-- instrumento ARS
	66 AS instrumentId,
	o.userid,
	size * price AS size,
	1 AS price,
	CASE
		WHEN o.side = 'BUY' THEN 'CASH_OUT'
		WHEN o.side = 'SELL' THEN 'CASH_IN'
	END AS side,
	type,
	status,
	datetime
FROM
	orders o
WHERE
	o.side IN ('BUY', 'SELL')
	AND o.status != 'REJECTED';

-- las rejected no generan cash in ni cash out porque fallan inmmediatamente
-- acá estoy asumiento que las limit, solo puede cancelarlas el usuario y sino quedan ad eternum
-- esperando que se den las condiciones de mercado para su ejecución.

-- ahora el insert para la posición consolidada de cada instrumento

-- encontré un bug en la data inicial para las ordenes del instrumento 31
-- el usuario vendió acciones que no tenía realmente ya que el buy está en NEW

-- como soy bueno antes de generar los balances le voy a pasar esa orden a FILLED
-- así no me arruina mi check de que quantity en balance debe ser >= 0, lo cual tiene mucho sentido.

update orders set status = 'FILLED' where id = 7;

INSERT INTO balances (userId, instrumentId, quantity, reserved)
SELECT 
  o.userId,
  o.instrumentId,
  SUM(
    CASE 
      WHEN o.side IN ('BUY','CASH_IN') AND o.status = 'FILLED' THEN o.size
      WHEN o.side IN ('SELL', 'CASH_OUT') AND o.status = 'FILLED' THEN -o.size 
      ELSE 0 
    END
  ) AS quantity,
  SUM(
    CASE
      WHEN o.side IN ('SELL','CASH_OUT') AND o.status = 'NEW' THEN o.size
      ELSE 0
    END
  ) AS reserved
FROM orders o
GROUP BY o.userId, o.instrumentId;

-- rendimiento
--------------

-- Existen varias formas de calcular el rendimiento de un activo:
    -- simple return
    -- si uno compró en varios momentos (precio promedio ponderado)
    -- si se quieren incluir dividendos
    -- si compras y vendes varias veces (lotes cerrados)

-- En nuestro caso por simplicidad vamos a implementar el precio promedio ponderado.

-- NOTA: para el caso del rendimiento total, es necesario destacar que este approach solo va a funcionar para "total global"
-- porque al final de cuenta lo que vamos a estar haciendo es sumar comprar y sumar ventas indistintamente de cuando 
-- se hizo cada compra y cada venta. Si quisieramos tener rendimientos por periodos (última semana, último mez, etc) 
-- deberíamos implementar alguna estrategia de snapshots diarios para ir trackeando la evolución de esos activos. 
-- Además sería necesario detectar cuando el activo queda en cero porque eso debería reiniciar el rendimiento. 
-- Habría que analizar alternativas en función de que se necesita a corto y a largo plazo. 
-- En un punto postgres puede dejar de ser la mejor opción y es viable empezar a buscar alternativas 
-- del estilo bases de datos columnares que son más eficientes para online analytics

-- NOTA2: Ordenes de tipo LIMIT, estas ordenes necesitan de un sistema externo para pasar a FILLED, son asíncronas. 
-- No se van a contemplar en calculos hasta que hayan sido transicionadas. Una forma de hacer esto es escuchando el CDC de postgres,
-- cuando se detecta que se insertó una orden en estado NEW de tipo LIMIT se escucha a ese evento y se reacciona.

-- NOTA3: No debería haber perdido tanto tiempo jugando con clickhouse y el CDC de debezium pero me daba curiosidad ver cómo se integrarían.
-- El docker-compose levanta lo servicios necesarios para empezar a jugar con eso.

-- curl -i -X POST -H "Accept:application/json" -H  "Content-Type:application/json" http://localhost:8083/connectors/ -d @register-postgres.json

-- Asumo que en la tabla order el precio es por unidad, dado los ejemplos de CASH_IN y CASH_OUT de moneda ARS 