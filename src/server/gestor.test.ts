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
  assert.deepEqual(c.ultimo().campanas, [{ id: CAMPANA_DEMO_ID, nombre: 'La mina perdida (demo)' }]);
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

test('el GM tira libre cuando quiere', async () => {
  const { gm } = await salaConGm();
  await gm.enviar({ tipo: 'tirar', notacion: '1d20+5' });
  await gm.enviar({ tipo: 'tirar', notacion: '2d6' });
  const ev = gm.ultimo().evento;
  assert.equal(ev.tipo, 'tirada');
  assert.ok(ev.datos.total >= 2 && ev.datos.total <= 12);
});

test('tirada con notación inválida da error y no se guarda', async () => {
  const { repo, gm } = await salaConGm();
  const antes = repo.todosLosEventos().length;
  await gm.enviar({ tipo: 'tirar', notacion: 'banana' });
  assert.equal(gm.ultimo().tipo, 'error');
  assert.equal(repo.todosLosEventos().length, antes);
});

test('un jugador sin petición pendiente no puede tirar', async () => {
  const { gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await a.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.match(a.ultimo().mensaje, /ninguna tirada pendiente/);
});

test('la petición del GM se consume con una sola tirada y usa su notación', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[0], notacion: '1d4+100', motivo: 'Percepción' });
  assert.deepEqual(a.ultimo().estado.jugadores[0].tirada_pendiente, { notacion: '1d4+100', motivo: 'Percepción' });

  await a.enviar({ tipo: 'tirar', notacion: '1d20' });
  const ev = gm.ultimo().evento;
  assert.ok(ev.datos.total > 100);
  assert.equal(ev.datos.motivo, 'Percepción');
  assert.equal(ev.datos.exito, null);
  assert.equal(gm.ultimo().estado.jugadores[0].tirada_pendiente, null);

  await a.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.equal(a.ultimo().tipo, 'error');
});

test('con CD el resultado dice éxito o fracaso, y la CD no se difunde', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[0], notacion: '1d20', cd: 1 });
  assert.ok(!JSON.stringify(a.ultimo()).includes('"cd"'));
  await a.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.equal(gm.ultimo().evento.datos.exito, true);

  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[0], notacion: '1d20', cd: 30 });
  await a.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.equal(gm.ultimo().evento.datos.exito, false);
});

test('pedir un chequeo calcula notación y motivo con la ficha del personaje', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[1]); // Torvald: FUE 16, SAB 11
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[1], chequeo: 'atletismo' });
  assert.deepEqual(a.ultimo().estado.jugadores[0].tirada_pendiente, { notacion: '1d20+3', motivo: 'Atletismo' });
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[1], chequeo: 'nadar' });
  assert.equal(gm.ultimo().mensaje, 'Habilidad o salvación desconocida');
});

test('solo el GM pide tiradas', async () => {
  const { gestor, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await a.enviar({ tipo: 'pedir_tirada', personaje_id: PJ[0], notacion: '1d20' });
  assert.equal(a.ultimo().mensaje, 'Solo el GM puede hacer eso');
});

test('aplicar_pg respeta 0 y el máximo y marca inconsciente', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[1]); // Torvald, 13 PG
  const pgDe = () => a.ultimo().estado.jugadores[0];

  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: PJ[1], cantidad: -5 });
  assert.equal(pgDe().pg_actual, 8);
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: PJ[1], cantidad: -50 });
  assert.equal(pgDe().pg_actual, 0);
  assert.equal(pgDe().inconsciente, true);
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: PJ[1], cantidad: 99 });
  assert.equal(pgDe().pg_actual, 13);
  assert.equal(pgDe().inconsciente, false);

  await a.enviar({ tipo: 'aplicar_pg', personaje_id: PJ[1], cantidad: 5 });
  assert.equal(a.ultimo().mensaje, 'Solo el GM puede hacer eso');
});

test('reconexión: retoma su asiento y recibe historial', async () => {
  const { gestor, gm, codigo } = await salaConGm();
  const a = await jugador(gestor, codigo, PJ[0]);
  await a.enviar({ tipo: 'accion', texto: 'Enciendo una antorcha' });
  a.cerrar();
  await gm.enviar({ tipo: 'estado' });
  assert.equal(gm.ultimo().estado.jugadores[0].conectado, false);

  const vuelta = await jugador(gestor, codigo, PJ[0]);
  const bienvenida = vuelta.recibidos.find((m) => m.tipo === 'bienvenida')!;
  assert.equal(bienvenida.estado.jugadores.length, 1);
  assert.equal(bienvenida.estado.jugadores[0].conectado, true);
  assert.ok(bienvenida.historial.some((e: Msj) => e.tipo === 'accion'));
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

test('ver_personajes de una campaña sin personajes devuelve lista vacía, no error', async () => {
  const repo = new RepositorioMemoria({ campanas: [{ id: 'vacia', nombre: 'Sin nadie' }] });
  const gestor = new Gestor(repo, () => {});
  const gm = cliente(gestor);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: 'vacia' });
  const j = cliente(gestor);
  await j.enviar({ tipo: 'ver_personajes', codigo: gm.ultimo().codigo });
  assert.equal(j.ultimo().tipo, 'personajes');
  assert.deepEqual(j.ultimo().personajes, []);
});
