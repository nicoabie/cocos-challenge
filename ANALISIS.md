# Analisis

## Endpoint Portfolio
- **Portfolio**: La respuesta deberá devolver el valor total de la cuenta de un usuario, sus pesos disponibles para operar y el listado de activos que posee (incluyendo cantidad de acciones, el valor total monetario de la posición ($) y el rendimiento total (%)).

### Entendimiento

- El valor total de la cuenta de un usuario es: sus pesos para operar en el mercado (CASH_IN - CASH_OUT) + el valor monetario de cada posicion en ($)
- Cada vez que se hace un BUY o un SELL de un activo debe también registrarse el CASH_OUT o CASH_IN sobre el instrumento ARS respectivamente como un double entry ledger. De esta manera es más facil calcular pesos disponibles.
- Existen varias formas de calcular el rendimiento de un activo
    - simple return
    - si uno compró en varios momentos (precio promedio ponderado)
    - si se quieren incluir dividendos
    - si compras y vendes varias veces (lotes cerrados)

En nuestro caso por simplicidad vamos a implementar el precio promedio ponderado.

NOTA: para el caso del rendimiento total, es necesario destacar que este approach solo va a funcionar para "total global" porque al final de cuenta lo que vamos a estar haciendo es sumar comprar y sumar ventas indistintamente de cuando se hizo cada compra y cada venta. Si quisieramos tener rendimientos por periodos (última semana, último mez, etc) deberíamos implementar alguna estrategia de snapshots diarios para ir trackeando la evolución de esos activos. Además sería necesario detectar cuando el activo queda en cero porque eso debería reiniciar el rendimiento. Habría que analizar alternativas en función de que se necesita a corto y a largo plazo. En un punto postgres puede dejar de ser la mejor opción y es viable empezar a buscar alternativas del estilo bases de datos columnares que son más eficientes para online analytics

NOTA2: Ordenes de tipo LIMIT, estas ordenes necesitan de un sistema externo para pasar a FILLED, son asíncronas. No se van a contemplar en calculos hasta que hayan sido transicionadas. Una forma de hacer esto es escuchando el CDC de postgres, cuando se detecta que se insertó una orden en estado NEW de tipo LIMIT se escucha a ese evento y se reacciona.

Asumo que en la tabla order el precio es por unidad, dado los ejemplos de CASH_IN y CASH_OUT de moneda ARS