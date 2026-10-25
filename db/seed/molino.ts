// Carga la aventura "El Molino Silencioso" en Postgres/Neon.
// Idempotente: si la campaña ya existe (por nombre) no hace nada. Todo en una transacción.
// Uso: node --env-file=.env db/seed/molino.ts
import pg from 'pg';
import { criaturas, diagrama, NOMBRE_CAMPANA, resumen, variables } from './molino-datos.ts';

const NOMBRE_GM = 'laucho';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('begin');
  const existente = await db.query<{ id: string }>('select id from campanas where nombre = $1', [NOMBRE_CAMPANA]);
  if (existente.rows.length) {
    await db.query('rollback');
    console.log(`La campaña ya existe (${existente.rows[0].id}); no se cambió nada.`);
  } else {
    const gm = await db.query<{ id: string }>('insert into usuarios (nombre) values ($1) returning id', [NOMBRE_GM]);
    const campana = await db.query<{ id: string }>(
      `insert into campanas (nombre, gm_usuario_id, diagrama, variables, resumen)
       values ($1, $2, $3, $4, $5) returning id`,
      [NOMBRE_CAMPANA, gm.rows[0].id, JSON.stringify(diagrama), JSON.stringify(variables), resumen],
    );
    for (const c of criaturas) {
      await db.query('insert into criaturas (campana_id, nombre, srd_clave, stats) values ($1, $2, $3, $4)',
        [campana.rows[0].id, c.nombre, c.srd_clave, JSON.stringify(c.stats)]);
    }
    await db.query('commit');
    console.log(`Campaña creada: ${campana.rows[0].id} (GM usuario ${gm.rows[0].id}, ${criaturas.length} criaturas)`);
  }
} catch (err) {
  await db.query('rollback');
  console.error('No se pudo cargar la campaña:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
