// Copia los archivos estáticos del dashboard a dist/ tras compilar.
import { cpSync, existsSync } from "node:fs";

if (existsSync("src/dashboard/public")) {
  cpSync("src/dashboard/public", "dist/dashboard/public", { recursive: true });
}
