# API Documentation

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

#### POST /orders/:id/cancel
Cancela una orden existente (solo órdenes con estado NEW).

```bash
curl -X POST http://localhost:3000/orders/123/cancel
```

#### GET /orders/user/:userId
Obtiene todas las órdenes de un usuario específico.

```bash
curl -X GET http://localhost:3000/orders/user/1
```

#### GET /users/:id/portfolio
Obtiene el portfolio completo de un usuario con posiciones actuales y valor total.

```bash
curl -X GET http://localhost:3000/users/1/portfolio
```

**Respuesta:**
```json
{
  "totalValue": 150000.50,
  "availableCash": 25000.00,
  "positions": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "quantity": 100,
      "totalValue": 15000.00,
      "performance": 5.2
    },
    {
      "ticker": "GOOGL",
      "name": "Alphabet Inc.",
      "quantity": 50,
      "totalValue": 110000.50,
      "performance": -2.1
    }
  ]
}
```
