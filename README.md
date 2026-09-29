# mcp-caicedo

Servidor MCP (Model Context Protocol) en TypeScript para un bot de copy trading en Solana.

Por ahora expone una sola herramienta, `health`, que confirma que el servidor está vivo y devuelve su versión y tiempo en marcha.

## Requisitos

- Node.js 22.12 o superior

## Uso

```bash
npm install
npm run build
npm start          # servidor MCP por stdio
npm run dev        # igual, sin compilar (tsx)
```

Para conectarlo a un cliente MCP (por ejemplo Claude Desktop), añade:

```json
{
  "mcpServers": {
    "mcp-caicedo": {
      "command": "node",
      "args": ["/ruta/a/mcp-caicedo/dist/index.js"]
    }
  }
}
```

## Desarrollo

```bash
npm run typecheck
npm test
```

La CI (GitHub Actions) ejecuta typecheck, tests y build en Node 22 y 24.
