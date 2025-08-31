# Orders API Documentation

## Enviar una orden al mercado

Esta implementación permite enviar órdenes de compra y venta al mercado con soporte para órdenes MARKET y LIMIT.

### Endpoints

#### POST /orders
Crea una nueva orden en el mercado.

**Body:**
```json
{
  "userId": 1,
  "instrumentId": 47,
  "size": 50,              // Opcional si se proporciona totalAmount
  "totalAmount": 46500,    // Opcional si se proporciona size
  "price": 930.00,         // Requerido para órdenes LIMIT
  "type": "MARKET",        // MARKET | LIMIT
  "side": "BUY"           // BUY | SELL | CASH_IN | CASH_OUT
}
```

**Ejemplos cURL:**

#### 1. **Orden MARKET de compra por cantidad específica:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "instrumentId": 47,
    "size": 50,
    "type": "MARKET",
    "side": "BUY"
  }'
```

#### 2. **Orden MARKET de compra por monto total:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "instrumentId": 47,
    "totalAmount": 46500,
    "type": "MARKET",
    "side": "BUY"
  }'
```

#### 3. **Orden LIMIT de compra:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "instrumentId": 47,
    "size": 60,
    "price": 920.00,
    "type": "LIMIT",
    "side": "BUY"
  }'
```

#### 4. **Orden MARKET de venta:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "instrumentId": 47,
    "size": 10,
    "type": "MARKET",
    "side": "SELL"
  }'
```

#### 5. **Transferencia de efectivo (ingreso):**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "instrumentId": 66,
    "size": 100000,
    "price": 1,
    "type": "MARKET",
    "side": "CASH_IN"
  }'
```

#### PATCH /orders/:id/cancel
Cancela una orden existente (solo órdenes con estado NEW).

```bash
curl -X PATCH http://localhost:3000/orders/123/cancel
```

#### GET /orders/user/:userId
Obtiene todas las órdenes de un usuario específico.

```bash
curl -X GET http://localhost:3000/orders/user/1
```

### Estados de las órdenes

- **NEW**: Orden límite enviada al mercado
- **FILLED**: Orden ejecutada (órdenes MARKET se ejecutan inmediatamente)
- **REJECTED**: Orden rechazada por no cumplir requisitos (fondos/acciones insuficientes)
- **CANCELLED**: Orden cancelada por el usuario

### Validaciones implementadas

1. **Órdenes de compra**: Valida que el usuario tenga pesos suficientes
2. **Órdenes de venta**: Valida que el usuario tenga acciones suficientes
3. **Órdenes MARKET**: Se ejecutan inmediatamente al precio de mercado actual
4. **Órdenes LIMIT**: Requieren precio y quedan pendientes hasta cancelación
5. **Cálculo automático**: Si se proporciona `totalAmount` en lugar de `size`, se calcula automáticamente la cantidad máxima de acciones

### Funcionalidad de transferencias

El sistema también soporta transferencias de efectivo usando los tipos:
- **CASH_IN**: Ingreso de dinero
- **CASH_OUT**: Egreso de dinero

### Notas técnicas

- Los precios se obtienen de la tabla `marketdata` (columna `close`)
- El balance se calcula en base a todas las órdenes FILLED del usuario
- Las órdenes solo se pueden cancelar si están en estado NEW
- No se admiten fracciones de acciones