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




