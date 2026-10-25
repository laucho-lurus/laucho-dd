import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PerfilesPg, type Consultor } from './perfiles-pg.ts';
import { PERFILES_INICIALES, type PerfilGm } from './perfiles.ts';

const esquema = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const columnasGm = /create table gm_perfiles \(([\s\S]*?)\n\);/.exec(esquema)![1]
  .split('\n').map((l) => l.trim().split(' ')[0]).filter((c) => /^[a-z_]+$/.test(c));

/** gm_perfiles en memoria: entiende solo las consultas de PerfilesPg y comprueba sus columnas. */
function tablaFalsa(filas: Record<string, string>[] = []) {
  const sqls: string[] = [];
  const fila = (f: Record<string, string>) => ({ id: f.id, nombre: f.nombre, descripcion: f.descripcion, tono: f.prompt_sistema, dificultad: f.dificultad });
  const db: Consultor = {
    async query<T>(sql: string, params: unknown[] = []) {
      sqls.push(sql);
      for (const [, cols] of sql.matchAll(/insert into gm_perfiles \(([^)]+)\)/g)) {
        for (const c of cols.split(',').map((x) => x.trim())) assert.ok(columnasGm.includes(c), `gm_perfiles.${c} no existe`);
      }
      const p = params as string[] & string[][];
      if (sql.includes('unnest')) {
        if (filas.length === 0) (p[0] as unknown as string[]).forEach((nombre, i) => filas.push({ id: randomUUID(), nombre, descripcion: p[1][i], prompt_sistema: p[2][i], dificultad: p[3][i] }));
        return { rows: [] as T[] };
      }
      if (sql.startsWith('insert')) {
        const f = { id: randomUUID(), nombre: p[0], descripcion: p[1], prompt_sistema: p[2], dificultad: p[3] } as Record<string, string>;
        filas.push(f);
        return { rows: [fila(f)] as T[] };
      }
      if (sql.startsWith('update')) {
        const f = filas.find((x) => x.id === p[0]);
        if (f) Object.assign(f, { nombre: p[1], descripcion: p[2], prompt_sistema: p[3], dificultad: p[4] });
        return { rows: (f ? [fila(f)] : []) as T[] };
      }
      const lista = sql.includes('where id') ? filas.filter((x) => x.id === p[0]) : filas;
      return { rows: lista.map(fila) as T[] };
    },
  };
  return { db, filas, sqls };
}

const deLaucho: PerfilGm = { id: 'x', nombre: 'El Bardo Loco', descripcion: 'Rima todo', tono: 'En verso', dificultad: 'dura' };

test('tabla vacía: siembra los perfiles del JSON local una sola vez', async () => {
  const { db, filas } = tablaFalsa();
  const perfiles = new PerfilesPg(db, async () => [...PERFILES_INICIALES, deLaucho]);
  const lista = await perfiles.listar();
  assert.deepEqual(lista.map((p) => p.nombre), ['El Cronista', 'La Tabernera', 'El Bardo Loco']);
  assert.equal(lista[2].tono, 'En verso'); // tono ↔ prompt_sistema
  await perfiles.listar();
  await new PerfilesPg(db, async () => PERFILES_INICIALES).listar(); // "reinicio"
  assert.equal(filas.length, 3);
});

test('con perfiles ya en la tabla no siembra nada', async () => {
  const { db, filas } = tablaFalsa([{ id: randomUUID(), nombre: 'Propio', descripcion: 'd', prompt_sistema: 't', dificultad: 'rara' }]);
  const lista = await new PerfilesPg(db, async () => PERFILES_INICIALES).listar();
  assert.equal(filas.length, 1);
  assert.equal(lista[0].dificultad, 'normal'); // valor desconocido → normal
});

test('crea, edita y busca por uuid', async () => {
  const { db } = tablaFalsa();
  const perfiles = new PerfilesPg(db, async () => PERFILES_INICIALES);
  const nuevo = await perfiles.guardarPerfil(null, { nombre: 'N', descripcion: 'd', tono: 't', dificultad: 'dura' });
  const editado = await perfiles.guardarPerfil(nuevo.id, { ...nuevo, tono: 'otro' });
  assert.equal((await perfiles.buscar(nuevo.id))?.tono, 'otro');
  assert.equal(editado.id, nuevo.id);
  assert.equal(await perfiles.buscar('tabernera'), null); // ids del JSON no son uuid
  await assert.rejects(perfiles.guardarPerfil(randomUUID(), nuevo));
});
