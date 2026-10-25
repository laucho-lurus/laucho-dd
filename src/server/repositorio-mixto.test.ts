import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepositorioMixto } from './repositorio-mixto.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';

const REAL = '11111111-1111-4111-8111-111111111111';

function preparar() {
  const demo = new RepositorioMemoria(DATOS_DEMO);
  const neon = new RepositorioMemoria({ campanas: [{ id: REAL, nombre: 'El Molino Silencioso' }] });
  return { demo, neon, mixto: new RepositorioMixto(demo, neon) };
}

const pj = (campana_id: string) => ({
  id: crypto.randomUUID(), campana_id, nombre: 'ZZ', raza: 'Humano', clase: 'Mago', nivel: 1,
  caracteristicas: { fue: 10, des: 10, con: 10, int: 10, sab: 10, car: 10 }, pg_max: 6, pg_actual: 6, datos: {},
});

test('lista las campañas de ambos y las busca en el suyo', async () => {
  const { mixto } = preparar();
  assert.deepEqual((await mixto.listarCampanas()).map((c) => c.nombre), ['El Molino Silencioso', 'La mina perdida (demo)']);
  assert.equal((await mixto.buscarCampana(REAL))?.nombre, 'El Molino Silencioso');
  assert.equal((await mixto.personajesDeCampana(CAMPANA_DEMO_ID)).length, 7);
});

test('personajes, sesiones y eventos de la campaña real van al principal', async () => {
  const { mixto, demo, neon } = preparar();
  const p = pj(REAL);
  await mixto.crearPersonaje(p, null);
  await mixto.guardarPg(p.id, 2);
  assert.equal((await neon.personajesDeCampana(REAL))[0].pg_actual, 2);

  const real = (await mixto.crearSesion(REAL, 'AAAAAA'))!;
  const local = (await mixto.crearSesion(CAMPANA_DEMO_ID, 'BBBBBB'))!;
  await mixto.registrarEvento({ sesion_id: real.id, tipo: 'mensaje', autor: 'gm', datos: {} });
  await mixto.registrarEvento({ sesion_id: local.id, tipo: 'mensaje', autor: 'gm', datos: {} });
  assert.equal(neon.todosLosEventos().length, 1);
  assert.equal(demo.todosLosEventos().length, 1);
  assert.equal((await mixto.ultimosEventos(real.id, 10)).length, 1);
  assert.equal(await neon.buscarSesionPorCodigo('BBBBBB'), null);
});

test('no repite un código de sala entre ambos', async () => {
  const { mixto } = preparar();
  assert.ok(await mixto.crearSesion(CAMPANA_DEMO_ID, 'CCCCCC'));
  assert.equal(await mixto.crearSesion(REAL, 'CCCCCC'), null);
});
