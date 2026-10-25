import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';
import { GmIa, type ClienteIa } from '../ia/gm-ia.ts';
import { Presupuesto } from '../ia/presupuesto.ts';
import { Perfiles } from '../ia/perfiles.ts';

const BRISA = DATOS_DEMO.personajes![0].id;
type Msj = Record<string, any>;

const respuesta = (bloques: unknown[], stop = 'tool_use') =>
  ({ content: bloques, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as Anthropic.Message;
const usar = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}-${Math.random()}`, name, input });

async function mesa(respuestas: Anthropic.Message[], conIa = true) {
  const dir = mkdtempSync(join(tmpdir(), 'mesa-ia-'));
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = {
    crear: async (p) => {
      llamadas.push(p);
      const r = respuestas.shift();
      if (!r) throw new Error('API caída');
      return r;
    },
  };
  const gm = conIa ? new GmIa({ cliente, presupuesto: new Presupuesto(join(dir, 'gasto.json'), 5) }) : null;
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {}, { gm, perfiles: new Perfiles(join(dir, 'perfiles.json')) });
  const conectar = () => {
    const recibidos: Msj[] = [];
    const c = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
    return { recibidos, enviar: (m: Msj) => c.recibir(JSON.stringify(m)), ultimo: () => recibidos.at(-1)! };
  };
  const humano = conectar();
  await humano.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, ...(conIa && { gm_perfil_id: 'tabernera' }) });
  const codigo = humano.recibidos.find((m) => m.tipo === 'sesion_creada')?.codigo;
  const jugador = conectar();
  if (codigo) await jugador.enviar({ tipo: 'unirse', codigo, personaje_id: BRISA });
  return { gestor, humano, jugador, codigo, llamadas };
}

const eventos = (c: { recibidos: Msj[] }) => c.recibidos.filter((m) => m.tipo === 'evento').map((m) => m.evento);

test('acción → la IA pide tirada → el jugador tira → la IA narra el resultado', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([
    respuesta([usar('pedir_tirada', { jugador: BRISA, tirada: 'percepcion', cd: 10, motivo: 'Huellas' })], 'end_turn'),
    respuesta([usar('narrar', { texto: 'Ves huellas de kobold.' })], 'end_turn'),
  ]);
  await jugador.enviar({ tipo: 'accion', texto: 'Busco huellas' });
  await gestor.esperarIa(codigo);
  assert.deepEqual(jugador.ultimo().estado.jugadores[0].tirada_pendiente, { notacion: '1d20+1', motivo: 'Percepción' });

  await jugador.enviar({ tipo: 'tirar', notacion: '1d20+1' });
  await gestor.esperarIa(codigo);
  assert.match(llamadas[1].messages[0].content as string, /Brisa tiró Percepción .* contra CD 10: (ÉXITO|FRACASO)/);
  const narracion = eventos(jugador).at(-1);
  assert.equal(narracion.autor, 'gm_ia');
  assert.equal(narracion.datos.personaje_nombre, 'GM IA · La Tabernera');
  // El panel con notas y gasto solo llega al GM humano.
  assert.ok(humano.recibidos.some((m) => m.tipo === 'panel_gm' && m.gasto.gastado > 0));
  assert.ok(!jugador.recibidos.some((m) => m.tipo === 'panel_gm'));
});

test('pausada, la IA no responde ni gasta; reanudada vuelve', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([respuesta([usar('narrar', { texto: 'Hola' })], 'end_turn')]);
  await humano.enviar({ tipo: 'pausar_ia', pausada: true });
  assert.equal(eventos(humano).at(-1).datos.cambio, 'ia_pausa'); // sin error
  await jugador.enviar({ tipo: 'accion', texto: 'Grito' });
  await gestor.esperarIa(codigo);
  assert.equal(llamadas.length, 0);
  await humano.enviar({ tipo: 'pausar_ia', pausada: false });
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.equal(llamadas.length, 1);
});

test('el GM humano deshace la última intervención y cambia de nodo', async () => {
  const { gestor, humano, codigo } = await mesa([respuesta([usar('narrar', { texto: 'Algo raro' })], 'end_turn')]);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  const id = eventos(humano).at(-1).id;
  await humano.enviar({ tipo: 'deshacer_ia' });
  assert.deepEqual(eventos(humano).at(-1).datos.eventos, [id]);
  await humano.enviar({ tipo: 'deshacer_ia' });
  assert.equal(humano.ultimo().tipo, 'error');

  await humano.enviar({ tipo: 'cambiar_nodo', nodo_id: '3' });
  assert.equal(humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!.nodo.id, '3');
});

test('si la API falla, el GM ve el error y la sala sigue', async () => {
  const { gestor, humano, jugador, codigo } = await mesa([]);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.match(humano.recibidos.filter((m) => m.tipo === 'error').at(-1)!.mensaje, /La IA falló: API caída/);
  await jugador.enviar({ tipo: 'accion', texto: 'Sigo' });
  assert.equal(eventos(jugador).at(-1).tipo, 'accion');
});

test('sin API key no se puede crear sala con GM IA, pero sí con GM humano', async () => {
  const { humano, codigo } = await mesa([], false);
  assert.ok(codigo);
  await humano.enviar({ tipo: 'ver_campanas' });
  assert.equal(humano.ultimo().ia_disponible, false);
  const { gestor } = await mesa([], false);
  const recibidos: Msj[] = [];
  await gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) })
    .recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, gm_perfil_id: 'tabernera' }));
  assert.match(recibidos.at(-1)!.mensaje, /ANTHROPIC_API_KEY/);
});

test('tras reiniciar el servidor, la sala se retoma con nodo, variables, PG, historial e IA', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reinicio-'));
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const perfiles = new Perfiles(join(dir, 'perfiles.json'));
  const gmIa = () => new GmIa({ cliente: { crear: async () => respuesta([usar('fijar_variable', { nombre: 'antorchas_encendidas', valor: true })], 'end_turn') }, presupuesto: new Presupuesto(join(dir, 'g.json'), 5) });
  const conectar = (g: Gestor) => {
    const recibidos: Msj[] = [];
    const c = g.conectar({ enviar: (m) => recibidos.push(m as Msj) });
    return { recibidos, enviar: (m: Msj) => c.recibir(JSON.stringify(m)) };
  };

  const antes = new Gestor(repo, () => {}, { gm: gmIa(), perfiles });
  const gm = conectar(antes);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, gm_perfil_id: 'cronista' });
  const codigo = gm.recibidos.find((m) => m.tipo === 'sesion_creada')!.codigo;
  const brisa = conectar(antes);
  await brisa.enviar({ tipo: 'unirse', codigo, personaje_id: BRISA });
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: BRISA, cantidad: -4 });
  await gm.enviar({ tipo: 'cambiar_nodo', nodo_id: '2' });
  await gm.enviar({ tipo: 'narrar_escena' });
  await antes.esperarIa(codigo);
  await gm.enviar({ tipo: 'pausar_ia', pausada: true });

  // "Reinicio": un gestor nuevo sobre la misma base.
  const despues = new Gestor(repo, () => {}, { gm: gmIa(), perfiles });
  const vuelta = conectar(despues);
  await vuelta.enviar({ tipo: 'unirse', codigo, personaje_id: BRISA });
  const bienvenida = vuelta.recibidos.find((m) => m.tipo === 'bienvenida')!;
  assert.equal(bienvenida.estado.jugadores[0].pg_actual, 5);
  assert.ok(bienvenida.historial.some((e: Msj) => e.datos.cambio === 'nodo'));
  const guardada = (await repo.buscarSesionPorCodigo(codigo))!;
  assert.equal(guardada.nodo_actual, '2');
  assert.deepEqual(guardada.variables, { antorchas_encendidas: true });
  assert.equal(guardada.ia_pausada, true);
  assert.equal(guardada.ia_perfil_id, 'cronista');
});

test('la IA aplica daño, sale etiquetado y "Deshacer IA" lo revierte', async () => {
  const { gestor, humano, jugador, codigo } = await mesa([
    respuesta([usar('aplicar_pg', { personaje: BRISA, cantidad: -20, motivo: 'cae al pozo' })]),
    respuesta([usar('narrar', { texto: 'Brisa queda tendida.' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  const pg = eventos(jugador).find((e) => e.datos.cambio === 'pg');
  assert.equal(pg.autor, 'gm_ia');
  assert.equal(pg.datos.motivo, 'cae al pozo');
  assert.equal(pg.datos.firma, 'GM IA · La Tabernera');
  assert.equal(pg.datos.pg_actual, 0); // 9 PG: no baja de 0
  assert.equal(pg.datos.inconsciente, true);

  await humano.enviar({ tipo: 'deshacer_ia' });
  const brisa = jugador.ultimo().estado.jugadores[0];
  assert.equal(brisa.pg_actual, 9); // revierte solo lo realmente aplicado (−9)
  assert.equal(brisa.inconsciente, false);
  assert.equal(eventos(humano).at(-1).datos.eventos.length, 2);
});

test('con la casilla apagada la IA no puede tocar los PG', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([
    respuesta([usar('aplicar_pg', { personaje: BRISA, cantidad: -3, motivo: 'x' })]),
    respuesta([usar('narrar', { texto: 'Uf.' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'ia_permitir_pg', permitido: false });
  assert.equal(humano.ultimo().ia.puede_pg, false);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.ok(!llamadas[0].tools!.some((t) => 'name' in t && t.name === 'aplicar_pg'));
  assert.equal(jugador.ultimo().estado.jugadores[0].pg_actual, 9);
});
