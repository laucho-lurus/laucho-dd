import { Gestor } from './gestor.ts';
import { crearServidor, rutaGm } from './http.ts';
import { crearApi } from './api.ts';
import { AlmacenDisco } from './almacen.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { RepositorioPg } from './repositorio-pg.ts';
import { RepositorioMixto } from './repositorio-mixto.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';
import type { Repositorio } from './repositorio.ts';
import { crearGmIa } from '../ia/config.ts';
import { rutasDatos } from './rutas-datos.ts';
import { Perfiles, type AlmacenPerfiles } from '../ia/perfiles.ts';
import { PerfilesPg } from '../ia/perfiles-pg.ts';

// Uso:
//   node src/server/main.ts --memoria              → datos de demo en memoria
//   node --env-file=.env src/server/main.ts        → Neon (DATABASE_URL)
//   node --env-file=.env src/server/main.ts --demo → Neon + campaña demo en memoria
//   node --env-file=.env src/server/main.ts --verificar → solo prueba la conexión a Neon

const PUERTO = Number(process.env.PORT ?? 3000);
// En contenedores (Railway, Fly) hay que escuchar en todas las interfaces, no solo localhost.
const HOST = process.env.HOST ?? '0.0.0.0';
const rutas = rutasDatos(process.env);
const args = new Set(process.argv.slice(2));
let postgres: RepositorioPg | null = null;

async function repositorio(): Promise<Repositorio> {
  if (args.has('--memoria')) {
    console.log(`Repositorio en memoria. Campaña de demo: ${CAMPANA_DEMO_ID}`);
    return new RepositorioMemoria(DATOS_DEMO);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (usa --env-file=.env o --memoria)');
  const pg = new RepositorioPg(url);
  postgres = pg;
  const tablas = await pg.verificar();
  console.log(`Conectado a Postgres (${tablas.length} tablas)`);
  if (args.has('--verificar')) {
    console.log(tablas.join(', '));
    await pg.cerrar();
    process.exit(0);
  }
  if (args.has('--demo')) {
    console.log('Campaña de demo disponible en memoria junto a las de Postgres');
    return new RepositorioMixto(new RepositorioMemoria(DATOS_DEMO), pg);
  }
  return pg;
}

try {
  const repo = await repositorio();
  const { gm, info } = crearGmIa(process.env);
  console.log(info);
  // Con Neon, los perfiles viven en gm_perfiles; el JSON local solo siembra la tabla vacía (una vez).
  const respaldo = new Perfiles(rutas.perfiles);
  const base = postgres as RepositorioPg | null; // lo asigna repositorio(); TS no lo ve
  const perfiles: AlmacenPerfiles = base ? new PerfilesPg(base.consultor(), () => respaldo.listar()) : respaldo;
  crearServidor(new Gestor(repo, undefined, { gm, perfiles }), crearApi(repo, perfiles, new AlmacenDisco(rutas.uploads)), { rutaGm: rutaGm(process.env.GM_RUTA) }).listen(PUERTO, HOST, () => console.log(`Servidor de salas en http://${HOST}:${PUERTO}`));
} catch (err) {
  console.error('No se pudo arrancar:', (err as Error).message);
  process.exit(1);
}
