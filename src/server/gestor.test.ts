import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';

const PJ = DATOS_DEMO.personajes!.map((p) => p.id);

type Msj = Record<string, any>;

/** Cliente falso: guarda lo que recibe y manda mensajes como objetos. */
function cliente(gestor: Gestor) {
  const recibidos: Msj[] = [];
  const conexion = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  return {
    recibidos,
    ultimo: () => recibidos.at(-1)!,
    enviar: (m: Msj) => conexion.recibir(JSON.stringify(m)),
    cerrar: () => conexion.cerrar(),
  };
}

async function salaConGm() {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const gestor = new Gestor(repo, () => {});
  const gm = cliente(gestor);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID });
  const creada = gm.ultimo();
  return { repo, gestor, gm, codigo: creada.codigo as string, token: creada.token_gm as string };
}

async function jugador(gestor: Gestor, codigo: string, personaje_id: string) {
  const j = cliente(gestor);
  await j.enviar({ tipo: 'unirse', codigo, personaje_id });
  return j;
}

test('crear sala devuelve código, token y GM conectado', async () => {
  const { gm, codigo, token } = await salaConGm();
  const m = gm.ultimo();
  assert.equal(m.tipo, 'sesion_creada');
  assert.match(codigo, /^[A-Z0-9]+$/);
  assert.ok(token.length > 0);
  assert.equal(m.estado.gm_conectado, true);
});

test('ver_campanas lista id y nombre', async () => {
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {});
  const c = cliente(gestor);
  await c.enviar({ tipo: 'ver_campanas' });
  assert.deepEqual(c.ultimo(), { tipo: 'campanas', campanas: DATOS_DEMO.campanas });
});

test('crear sala con campaña inexistente da error', async () => {
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {});
  const c = cliente(gestor);
  await c.enviar({ tipo: 'crear_sesion', campana_id: 'nope' });
  assert.equal(c.ultimo().tipo, 'error');
});

test('unirse da bienvenida y avisa al GM', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const j = await jugador(gestor, codigo.toLowerCase(), PJ[0]);
  const bienvenida = j.recibidos.find((m) => m.tipo === 'bienvenida');
  assert.equal(bienvenida?.personaje_id, PJ[0]);
  assert.equal(gm.ultimo().tipo, 'evento');
  assert.equal(gm.ultimo().estado.jugadores.length, 1);
});

test('código inexistente o personaje ocupado se rechazan', async () => {
  const { gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, 'ZZZZZZ', PJ[0]);
  assert.equal(a.ultimo().tipo, 'error');
  await jugador(gestor, codigo, PJ[0]);
  const b = await jugador(gestor, codigo, PJ[0]);
  assert.equal(b.ultimo().mensaje, 'Ese personaje ya está en juego');
});

test('acción fuera de turno se rechaza; en turno se publica', async () => {
  const { repo, gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  const b = await jugador(gestor, codigo, PJ[1]);

  await b.enviar({ tipo: 'accion', texto: 'Ataco' });
  assert.equal(b.ultimo().mensaje, 'No es tu turno');

  await a.enviar({ tipo: 'accion', texto: 'Abro la puerta' });
  assert.equal(b.ultimo().evento.tipo, 'accion');
  assert.equal(repo.todosLosEventos().at(-1)!.datos.texto, 'Abro la puerta');
});

test('el GM pasa el turno y solo el GM puede', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await jugador(gestor, codigo, PJ[1]);
  await a.enviar({ tipo: 'siguiente_turno' });
  assert.equal(a.ultimo().mensaje, 'Solo el GM puede hacer eso');
  await gm.enviar({ tipo: 'siguiente_turno' });
  assert.equal(gm.ultimo().estado.turno_de, PJ[1]);
});

test('tirada válida se difunde con total', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await a.enviar({ tipo: 'tirar', notacion: '1d20+5', motivo: 'Percepción' });
  const ev = gm.ultimo().evento;
  assert.equal(ev.tipo, 'tirada');
  assert.ok(ev.datos.total >= 6 && ev.datos.total <= 25);
  assert.equal(ev.datos.motivo, 'Percepción');
});

test('tirada inválida da error y no se guarda', async () => {
  const { repo, gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  const antes = repo.todosLosEventos().length;
  await a.enviar({ tipo: 'tirar', notacion: 'banana' });
  assert.equal(a.ultimo().tipo, 'error');
  assert.equal(repo.todosLosEventos().length, antes);
});

test('reconexión: retoma su asiento y recibe historial', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await a.enviar({ tipo: 'tirar', notacion: '1d6' });
  a.cerrar();
  await gm.enviar({ tipo: 'estado' });
  assert.equal(gm.ultimo().estado.jugadores[0].conectado, false);

  const vuelta = await jugador(gestor, codigo, PJ[0]);
  const bienvenida = vuelta.recibidos.find((m) => m.tipo === 'bienvenida')!;
  assert.equal(bienvenida.estado.jugadores.length, 1);
  assert.equal(bienvenida.estado.jugadores[0].conectado, true);
  assert.ok(bienvenida.historial.some((e: Msj) => e.tipo === 'tirada'));
});

test('sala llena: el séptimo jugador no entra', async () => {
  const { gestor, codigo } = await salaConGm();
  for (const id of PJ.slice(0, 6)) await jugador(gestor, codigo, id);
  const septimo = await jugador(gestor, codigo, PJ[6]);
  assert.match(septimo.ultimo().mensaje, /llena/);
});

test('el estado incluye la ficha del personaje', async () => {
  const { gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[1]);
  const torvald = a.ultimo().estado.jugadores[0];
  assert.equal(torvald.ca, 18);
  assert.equal(torvald.pg_actual, torvald.pg_max);
  assert.equal(torvald.caracteristicas.fue, 16);
  assert.ok(torvald.armas.length > 0);
});
