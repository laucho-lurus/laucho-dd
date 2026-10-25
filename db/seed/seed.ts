// Carga una aventura en Postgres/Neon. Idempotente: si ya existe una campaña con ese nombre, no hace nada.
// Uso:
//   npm run seed -- <id>             carga la aventura (molino, cripta, feria, rey, minas, mar)
//   npm run seed -- <id> --imagenes  solo muestra las imágenes que necesita (no toca la base)
//   npm run seed                     lista las aventuras disponibles
import pg from 'pg';
import { AVENTURAS } from './campanas/index.ts';
import { imagenesDeCampana } from '../../src/rules/imagenes.ts';
import type { SemillaCampana } from './semilla.ts';

const GM = 'laucho'; // usuario GM humano de las campañas cargadas

/** Checklist de imágenes, con el mismo formato que la página /imagenes. */
export const imagenesNecesarias = (a: SemillaCampana, campanaId = a.id) =>
  imagenesDeCampana(campanaId, a.diagrama, (a.criaturas ?? []).map((c) => ({ srd_clave: c.srd_clave, nombre: c.nombre })));

async function cargar(a: SemillaCampana) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('begin');
    const existente = await db.query<{ id: string }>('select id from campanas where nombre = $1', [a.nombre]);
    if (existente.rows.length) {
      await db.query('rollback');
      return console.log(`«${a.nombre}» ya existe (${existente.rows[0].id}); no se cambió nada.`);
    }
    const usuario = await db.query<{ id: string }>('select id from usuarios where nombre = $1 order by creado_en limit 1', [GM]);
    const gmId = usuario.rows[0]?.id
      ?? (await db.query<{ id: string }>('insert into usuarios (nombre) values ($1) returning id', [GM])).rows[0].id;
    const campana = await db.query<{ id: string }>(
      'insert into campanas (nombre, gm_usuario_id, diagrama, variables, resumen) values ($1, $2, $3, $4, $5) returning id',
      [a.nombre, gmId, JSON.stringify(a.diagrama), JSON.stringify(a.variables), a.resumen],
    );
    for (const c of a.criaturas ?? []) {
      await db.query('insert into criaturas (campana_id, nombre, srd_clave, stats) values ($1, $2, $3, $4)',
        [campana.rows[0].id, c.nombre, c.srd_clave, JSON.stringify(c.stats)]);
    }
    await db.query('commit');
    console.log(`Cargada «${a.nombre}»: ${campana.rows[0].id} (${a.diagrama.nodos.length} nodos, ${imagenesNecesarias(a).length} imágenes por subir en /imagenes)`);
  } catch (err) {
    await db.query('rollback');
    console.error(`No se pudo cargar «${a.nombre}»:`, (err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

const [id, opcion] = process.argv.slice(2);
const aventura = id ? AVENTURAS[id] : undefined;
if (!aventura) {
  console.log('Aventuras disponibles (npm run seed -- <id>):');
  for (const a of Object.values(AVENTURAS)) console.log(`  ${a.id.padEnd(7)} ${a.nombre} — ${a.diagrama.nodos.length} nodos`);
  if (id) process.exitCode = 1;
} else if (opcion === '--imagenes') {
  for (const i of imagenesNecesarias(aventura)) console.log(`☐ ${i.nombre}  (${i.pertenece_a})`);
} else {
  await cargar(aventura);
}
