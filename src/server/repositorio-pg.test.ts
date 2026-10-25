import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RepositorioPg } from './repositorio-pg.ts';

// Sin base de datos: captura las consultas y las compara con db/schema.sql.
const esquema = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');

/** Columnas de una tabla del esquema y cuáles son obligatorias (NOT NULL sin default). */
function columnas(tabla: string) {
  const cuerpo = new RegExp(`create table ${tabla} \\(([\\s\\S]*?)\\n\\);`).exec(esquema)![1];
  const filas = cuerpo.split('\n').map((l) => l.replace(/--.*/, '').trim()).filter((l) => /^[a-z_]+ /.test(l) && !l.startsWith('check'));
  return {
    todas: filas.map((l) => l.split(' ')[0]),
    obligatorias: filas.filter((l) => /not null/.test(l) && !/default|primary key/.test(l)).map((l) => l.split(' ')[0]),
  };
}

function repoFalso() {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] };
  };
  const repo = new RepositorioPg('postgres://falso@localhost/x');
  Object.assign(repo, { pool: { query, connect: async () => ({ query, release() {} }) } });
  return { repo, consultas };
}

const personaje = {
  id: '11111111-1111-4111-8111-111111111111', campana_id: '059ecc4a-947c-4a00-aa9d-9f98bdb407c9', nombre: 'ZZ prueba',
  descripcion: '', raza: 'Humano', clase: 'Guerrero', nivel: 1,
  caracteristicas: { fue: 16, des: 15, con: 14, int: 13, sab: 11, car: 9 }, pg_max: 12, pg_actual: 12, datos: { ca: 12 },
};

function revisarInsert(sql: string, params: unknown[], tabla: string) {
  const m = new RegExp(`insert into ${tabla} \\(([^)]+)\\)\\s*values \\(([^)]+)\\)`).exec(sql.replace(/\s+/g, ' '));
  assert.ok(m, `no encontré el insert en ${tabla}`);
  const cols = m[1].split(',').map((c) => c.trim());
  const { todas, obligatorias } = columnas(tabla);
  for (const c of cols) assert.ok(todas.includes(c), `${tabla}.${c} no existe en el esquema`);
  for (const c of obligatorias) assert.ok(cols.includes(c), `falta ${tabla}.${c} (NOT NULL sin default)`);
  const marcadores = m[2].match(/\$\d+/g) ?? [];
  assert.equal(new Set(marcadores).size, params.length, `parámetros de ${tabla} no cuadran`);
  return Object.fromEntries(cols.map((c, i) => [c, m[2].split(',')[i].trim().startsWith('$') ? params[Number(m[2].split(',')[i].trim().slice(1)) - 1] : m[2].split(',')[i].trim()]));
}

test('crearPersonaje sin foto: el INSERT coincide con el esquema e imagen_id es null', async () => {
  const { repo, consultas } = repoFalso();
  const r = await repo.crearPersonaje(personaje, null);
  assert.deepEqual(consultas.map((c) => c.sql.trim().split(/\s/)[0]), ['begin', 'insert', 'commit']);
  const fila = revisarInsert(consultas[1].sql, consultas[1].params, 'personajes');
  assert.equal(fila.imagen_id, null);
  assert.deepEqual(JSON.parse(fila.caracteristicas as string), personaje.caracteristicas);
  assert.equal(r.imagen_url, null);
});

test('crearPersonaje con foto: inserta imagen y enlaza su id', async () => {
  const { repo, consultas } = repoFalso();
  const r = await repo.crearPersonaje(personaje, { ruta: 'uploads/x.png' });
  revisarInsert(consultas[1].sql, consultas[1].params, 'imagenes');
  const fila = revisarInsert(consultas[2].sql, consultas[2].params, 'personajes');
  assert.equal(fila.imagen_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(r.imagen_url, '/uploads/x.png');
});

test('si falla el INSERT hace rollback', async () => {
  const { repo, consultas } = repoFalso();
  const pool = (repo as unknown as { pool: { connect: () => Promise<unknown> } }).pool;
  pool.connect = async () => ({
    query: async (sql: string) => {
      consultas.push({ sql, params: [] });
      if (sql.includes('insert')) throw new Error('violación');
      return { rows: [] };
    },
    release() {},
  });
  await assert.rejects(repo.crearPersonaje(personaje, null));
  assert.equal(consultas.at(-1)!.sql, 'rollback');
});
