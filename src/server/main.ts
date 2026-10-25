import { Gestor } from './gestor.ts';
import { crearServidor } from './http.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { RepositorioPg } from './repositorio-pg.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';
import type { Repositorio } from './repositorio.ts';

// Uso:
//   node src/server/main.ts --memoria              → datos de demo en memoria
//   node --env-file=.env src/server/main.ts        → Neon (DATABASE_URL)
//   node --env-file=.env src/server/main.ts --verificar → solo prueba la conexión a Neon

const PUERTO = Number(process.env.PORT ?? 3000);
const args = new Set(process.argv.slice(2));

async function repositorio(): Promise<Repositorio> {
  if (args.has('--memoria')) {
    console.log(`Repositorio en memoria. Campaña de demo: ${CAMPANA_DEMO_ID}`);
    return new RepositorioMemoria(DATOS_DEMO);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (usa --env-file=.env o --memoria)');
  const pg = new RepositorioPg(url);
  const tablas = await pg.verificar();
  console.log(`Conectado a Postgres (${tablas.length} tablas)`);
  if (args.has('--verificar')) {
    console.log(tablas.join(', '));
    await pg.cerrar();
    process.exit(0);
  }
  return pg;
}

try {
  const gestor = new Gestor(await repositorio());
  crearServidor(gestor).listen(PUERTO, () => console.log(`Servidor de salas en http://localhost:${PUERTO}`));
} catch (err) {
  console.error('No se pudo arrancar:', (err as Error).message);
  process.exit(1);
}
