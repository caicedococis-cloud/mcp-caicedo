# mcp-caicedo

Bot de copy trading para Solana. Por ahora solo funciona en **modo papel**: simula las operaciones copiadas sin claves ni ejecución real.

## Modo papel (`src/paper`)

`PaperTrader` recibe las operaciones de las billeteras seguidas (`WalletTrade`) y las convierte en operaciones simuladas:

- **Tamaño de posición**: `fixed` (SOL fijos por compra), `proportional` (fracción de lo que gastó la billetera) o `percentOfBalance` (% del saldo simulado).
- **Límites de riesgo**: `maxPerTradeSol` (máximo por operación) y `dailyCapSol` (gasto máximo en compras por día UTC). Las compras se recortan al límite; si quedan por debajo de `minTradeSol` se omiten con su motivo.
- **Ventas**: si la billetera vende el 25 % de lo que compró, se vende el 25 % de nuestra posición copiada de esa billetera.
- **Realismo**: deslizamiento (`slippageBps`) en contra en ambos lados y una comisión fija por operación (`feeSol`).
- **Registro**: cada fill y cada omisión quedan guardados; `summary()` da saldo, PnL realizado y no realizado, comisiones y tasa de acierto. `savePaperState` / `loadPaperState` guardan todo en JSON.

```ts
import { PaperTrader } from "./src/paper/index.js";

const trader = new PaperTrader({ sizing: { mode: "fixed", sol: 0.1 }, maxPerTradeSol: 0.5, dailyCapSol: 2 });
trader.process({ signature, wallet, tokenMint, side: "buy", tokenAmount, solAmount, timestamp });
console.log(trader.summary());
```

## Desarrollo

```sh
npm install
npm test
npm run typecheck
```
