# mcp-caicedo

Servidor MCP para un bot de copy trading en Solana.

## Herramientas de seguimiento de wallets (solo lectura)

No usan ni guardan claves privadas: solo leen el historial público de la cadena a través de la API de Helius.

| Herramienta | Qué hace |
| --- | --- |
| `watchlist_add` | Agrega una wallet a la lista de seguimiento (o cambia su apodo). |
| `watchlist_remove` | Quita una wallet de la lista. |
| `watchlist_list` | Muestra las wallets seguidas. |
| `wallet_recent_swaps` | Swaps recientes de una wallet como operaciones normalizadas. |
| `watchlist_recent_swaps` | Swaps recientes de todas las wallets seguidas, del más nuevo al más viejo. |

Cada operación normalizada trae `tokenIn` (lo que la wallet entregó), `tokenOut` (lo que recibió), `size` (monto en SOL o stablecoin cuando aplica), `side` (`buy`, `sell` o `swap`), `timestamp`, `source` (DEX) y `signature`.

## Uso

```bash
npm install
npm run build
HELIUS_API_KEY=tu_clave npm start
```

Ver `.env.example` para las variables. La lista se guarda en `data/watchlist.json`, así que viaja con la carpeta del bot.

## Tests

```bash
npm test
```

Los tests usan respuestas simuladas de Helius y no hacen llamadas a la red.
