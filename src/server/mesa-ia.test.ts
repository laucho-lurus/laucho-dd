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
const COLGADA = {} as Anthropic.Message;

const respuesta = (bloques: unknown[], stop = 'tool_use') =>
  ({ content: bloques, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as Anthropic.Message;
const usar = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}-${Math.random()}`, name, input });

async function mesa(respuestas: Anthropic.Message[], conIa = true, tiempo_maximo_ms?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'mesa-ia-'));
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = {
    crear: async (p) => {
      llamadas.push(p);
      if (respuestas[0] === COLGADA) return new Promise(() => {}); // la API nunca contesta
      const r = respuestas.shift();
      if (!r) throw new Error('API caída');
      return r;
    },
  };
  const gm = conIa ? new GmIa({ cliente, presupuesto: new Presupuesto(join(dir, 'gasto.json'), 5) }) : null;
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {}, { gm, perfiles: new Perfiles(join(dir, 'perfiles.json')), tiempo_maximo_ms });
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

test('regresión: la IA responde a varias acciones seguidas (el bloqueo se libera siempre)', async () => {
  const narra = (t: string) => respuesta([usar('narrar', { texto: t })], 'end_turn');
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([
    narra('Uno.'),
    respuesta([usar('pedir_tirada', { jugador: BRISA, tirada: 'sigilo', cd: 12 })], 'end_turn'),
    narra('Tres.'),
    narra('Cuatro.'),
  ]);
  await jugador.enviar({ tipo: 'accion', texto: 'Primera' });
  await gestor.esperarIa(codigo);
  await jugador.enviar({ tipo: 'accion', texto: 'Segunda' }); // deja una tirada pendiente
  await gestor.esperarIa(codigo);
  await jugador.enviar({ tipo: 'accion', texto: 'Tercera' }); // con la tirada aún pendiente
  await gestor.esperarIa(codigo);
  await jugador.enviar({ tipo: 'tirar', notacion: '1d20' });
  await gestor.esperarIa(codigo);
  assert.equal(llamadas.length, 4);
  assert.deepEqual(eventos(jugador).filter((e) => e.autor === 'gm_ia' && e.tipo === 'mensaje').map((e) => e.datos.texto), ['Uno.', 'Tres.', 'Cuatro.']);
  assert.ok(!humano.recibidos.some((m) => m.tipo === 'error'));
  assert.equal(humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!.ia.pensando, false);
});

test('regresión: tras un fallo de la API la siguiente acción vuelve a llamar', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([]);
  await jugador.enviar({ tipo: 'accion', texto: 'Primera' });
  await gestor.esperarIa(codigo);
  await jugador.enviar({ tipo: 'accion', texto: 'Segunda' });
  await gestor.esperarIa(codigo);
  assert.equal(llamadas.length, 2);
  assert.equal(humano.recibidos.filter((m) => m.tipo === 'error' && /La IA falló/.test(m.mensaje)).length, 2);
});

test('si la API se cuelga, a los 45 s (aquí 20 ms) se libera la sala y el GM lo ve', async () => {
  const { gestor, humano, codigo } = await mesa([COLGADA], true, 20);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.match(humano.recibidos.filter((m) => m.tipo === 'error').at(-1)!.mensaje, /no respondió/);
  assert.equal(humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!.ia.pensando, false);
});

test('bienvenida fija del GM IA: una vez, sin API, y queda en el historial', async () => {
  const { jugador, llamadas } = await mesa([]);
  const bienvenida = jugador.recibidos.find((m) => m.tipo === 'bienvenida')!;
  const caja = bienvenida.historial.filter((e: Msj) => e.tipo === 'sistema');
  assert.equal(caja.length, 1);
  assert.match(caja[0].datos.texto, /^Esta mesa la dirige La Tabernera \(GM IA\): Cálida y con humor/);
  assert.match(caja[0].datos.texto, /no puedes tirar por tu cuenta/);
  assert.equal(llamadas.length, 0);
});

test('chat de mesa: llega a todos, no gasta turno, no despierta a la IA y respeta límites', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([]);
  await jugador.enviar({ tipo: 'chat', texto: '¿Vamos por la izquierda?', en_personaje: false });
  const ev = eventos(humano).at(-1);
  assert.equal(ev.tipo, 'chat');
  assert.deepEqual([ev.datos.personaje_nombre, ev.datos.en_personaje], ['Brisa', false]);
  await gestor.esperarIa(codigo);
  assert.equal(llamadas.length, 0);

  await jugador.enviar({ tipo: 'chat', texto: 'otra', en_personaje: true });
  assert.match(jugador.ultimo().mensaje, /Espera un segundo/);
  await humano.enviar({ tipo: 'chat', texto: 'El GM también charla', en_personaje: false }); // cada uno su ritmo
  assert.equal(eventos(jugador).at(-1).autor, 'gm');
  await humano.enviar({ tipo: 'chat', texto: 'x'.repeat(301) });
  assert.match(humano.ultimo().mensaje, /300 caracteres/);
});

test('el chat se restaura al reunirse tras reiniciar y la IA lo ve etiquetado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-'));
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const opciones = () => ({
    gm: new GmIa({
      cliente: { crear: async (p) => (llamadas.push(p), respuesta([usar('narrar', { texto: 'Sigue.' })], 'end_turn')) },
      presupuesto: new Presupuesto(join(dir, 'g.json'), 5),
    }),
    perfiles: new Perfiles(join(dir, 'p.json')),
  });
  const antes = new Gestor(repo, () => {}, opciones());
  const recibidos: Msj[] = [];
  const gm = antes.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  await gm.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, gm_perfil_id: 'cronista' }));
  const codigo = recibidos.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await gm.recibir(JSON.stringify({ tipo: 'chat', texto: 'Pausa para el café', en_personaje: false }));

  const despues = new Gestor(repo, () => {}, opciones());
  const j: Msj[] = [];
  const brisa = despues.conectar({ enviar: (m) => j.push(m as Msj) });
  await brisa.recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: BRISA }));
  assert.ok(j.find((m) => m.tipo === 'bienvenida')!.historial.some((e: Msj) => e.tipo === 'chat' && e.datos.texto === 'Pausa para el café'));

  await brisa.recibir(JSON.stringify({ tipo: 'accion', texto: 'Miro alrededor' }));
  await despues.esperarIa(codigo);
  const prompt = llamadas[0].messages[0].content as string;
  assert.match(prompt, /\[chat de mesa\] GM: Pausa para el café/);
  assert.doesNotMatch(prompt.split('Chat de mesa reciente')[0], /Pausa para el café/);
});

test('"Qué sigue" recorre acción → IA pensando → tirada pendiente → resultado → siguiente turno', async () => {
  const TORVALD = DATOS_DEMO.personajes![1].id;
  const { gestor, humano, jugador, codigo } = await mesa([
    respuesta([usar('narrar', { texto: 'El kobold salta.' }), usar('pedir_tirada', { jugador: BRISA, tirada: '1d20+5', motivo: 'Ataque con estoque al kobold' })]),
    respuesta([usar('narrar', { texto: 'Le aciertas. Brisa, tu turno ha terminado: sigue Torvald.' })], 'end_turn'),
  ]);
  await gestor.conectar({ enviar: () => {} }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: TORVALD }));
  const vistos = () => jugador.recibidos.map((m) => m.estado?.que_sigue).filter(Boolean)
    .filter((t: string, i: number, a: string[]) => t !== a[i - 1]);

  assert.equal(vistos().at(-1), 'Turno de Brisa: escribe tu acción');
  await jugador.enviar({ tipo: 'accion', texto: 'Ataco al kobold' });
  await gestor.esperarIa(codigo);
  await jugador.enviar({ tipo: 'tirar', notacion: '1d20' });
  await gestor.esperarIa(codigo);
  await humano.enviar({ tipo: 'siguiente_turno' });

  assert.deepEqual(vistos().slice(-6), [
    'Turno de Brisa: escribe tu acción',
    'IA pensando…',
    'Esperando la tirada de Brisa: Ataque con estoque al kobold',
    'IA pensando…',
    'Turno de Brisa: escribe tu acción',
    'Turno de Torvald: escribe tu acción',
  ]);
  const peticion = eventos(jugador).find((e) => e.datos.cambio === 'pedir_tirada');
  assert.equal(peticion.datos.texto, 'El GM IA pide a Brisa: Ataque con estoque al kobold (1d20+5).');
  assert.match(eventos(jugador).find((e) => e.tipo === 'tirada').datos.texto, /^🎲 Brisa tira 1d20\+5 · Ataque con estoque al kobold: \[\d+\] \+5 = \d+$/);

  await humano.enviar({ tipo: 'pausar_ia', pausada: true });
  assert.equal(jugador.ultimo().estado.que_sigue, 'IA pausada: el GM humano decide');
});

test('monstruos: la IA los saca, el ataque usa su CA y el daño baja sus PG hasta caer', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([
    respuesta([usar('agregar_monstruos', { srd_clave: 'kobold', cantidad: 2 }), usar('narrar', { texto: 'Dos kobolds.' })], 'end_turn'),
    // acción 1 → ataque que no llega (1d4 < CA 12) → narra el fallo
    respuesta([usar('pedir_tirada', { jugador: BRISA, tirada: '1d4', motivo: 'Ataque con estoque al Kobold 1', objetivo_monstruo: 'm1', efecto: 'ataque' })]),
    respuesta([usar('narrar', { texto: 'Fallas.' })], 'end_turn'),
    // acción 2 → ataque que acierta → pide el daño → narra la caída
    respuesta([usar('pedir_tirada', { jugador: BRISA, tirada: '1d4+100', motivo: 'Ataque con estoque al Kobold 1', objetivo_monstruo: 'm1', efecto: 'ataque' })]),
    respuesta([usar('pedir_tirada', { jugador: BRISA, tirada: '1d4+100', motivo: 'Daño del estoque al Kobold 1', objetivo_monstruo: 'm1', efecto: 'daño' })]),
    respuesta([usar('narrar', { texto: 'Cae.' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.deepEqual(jugador.ultimo().estado.monstruos, [
    { id: 'm1', nombre: 'Kobold 1', estado: 'sano' },
    { id: 'm2', nombre: 'Kobold 2', estado: 'sano' },
  ]);
  const panel = humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!;
  assert.deepEqual(panel.monstruos.map((m: Msj) => [m.nombre, m.pg_actual, m.ca]), [['Kobold 1', 5, 12], ['Kobold 2', 5, 12]]);

  // Ataque que no llega a la CA 12 (1d4 ≤ 4) y uno que sí (≥ 101).
  for (const esperado of ['FALLA', 'ACIERTA']) {
    await jugador.enviar({ tipo: 'accion', texto: 'Ataco al kobold' });
    await gestor.esperarIa(codigo);
    assert.ok(!JSON.stringify(jugador.ultimo().estado).includes('"cd"'));
    await jugador.enviar({ tipo: 'tirar', notacion: '1d20' });
    await gestor.esperarIa(codigo);
    assert.match(llamadas.at(-1)!.messages[0].content as string, new RegExp(`contra la CA de Kobold 1: ${esperado}`));
  }
  // La IA pidió el daño: el servidor lo resta solo.
  await jugador.enviar({ tipo: 'tirar', notacion: '1d8' });
  await gestor.esperarIa(codigo);
  assert.equal(eventos(jugador).findLast((e) => e.datos.cambio === 'monstruos').datos.texto, 'Kobold 1 cae.');
  assert.equal(jugador.ultimo().estado.monstruos[0].estado, 'caído');
  assert.ok(!JSON.stringify(jugador.ultimo().estado.monstruos).match(/pg|ca"/i)); // sin cifras para jugadores
  assert.match(llamadas.at(-1)!.messages[0].content as string, /Kobold 1 cae\. \(Kobold 1: 0\/5 PG\)/);

  // Deshacer IA revierte el daño de la tirada que pidió.
  await humano.enviar({ tipo: 'deshacer_ia' });
  assert.equal(humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!.monstruos[0].pg_actual, 5);
});

test('monstruos: máximo 6 vivos, el GM humano los maneja y deshacer quita los que sacó la IA', async () => {
  const { gestor, humano, codigo, llamadas } = await mesa([
    respuesta([usar('agregar_monstruos', { srd_clave: 'goblin', cantidad: 3 })]),
    respuesta([usar('narrar', { texto: 'Goblins.' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 4 });
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  const resultado = (llamadas[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0].content;
  assert.match(String(resultado), /Máximo 6 monstruos vivos/);

  await humano.enviar({ tipo: 'monstruo_pg', monstruo_id: 'm2', cantidad: -3 });
  const panel = () => humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!;
  assert.equal(panel().monstruos[1].pg_actual, 2);
  await humano.enviar({ tipo: 'quitar_monstruo', monstruo_id: 'm4' });
  assert.equal(panel().monstruos.length, 3);
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'dragon', cantidad: 1 });
  assert.match(humano.ultimo().mensaje, /no está disponible/);
});

test('monstruos: se guardan y vuelven tras reiniciar', async () => {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const dir = mkdtempSync(join(tmpdir(), 'monstruos-'));
  const opciones = () => ({ gm: null, perfiles: new Perfiles(join(dir, 'p.json')) });
  const g1 = new Gestor(repo, () => {}, opciones());
  const r1: Msj[] = [];
  const gm = g1.conectar({ enviar: (m) => r1.push(m as Msj) });
  await gm.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID }));
  const codigo = r1.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await gm.recibir(JSON.stringify({ tipo: 'agregar_monstruos', srd_clave: 'wolf', cantidad: 1 }));
  await gm.recibir(JSON.stringify({ tipo: 'monstruo_pg', monstruo_id: 'm1', cantidad: -8 }));

  const g2 = new Gestor(repo, () => {}, opciones());
  const r2: Msj[] = [];
  await g2.conectar({ enviar: (m) => r2.push(m as Msj) }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: BRISA }));
  assert.deepEqual(r2.find((m) => m.tipo === 'bienvenida')!.estado.monstruos, [{ id: 'm1', nombre: 'Lobo 1', estado: 'malherido' }]);
});

test('el GM vuelve a entrar tras reiniciar con su token; con uno inválido se rechaza', async () => {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const dir = mkdtempSync(join(tmpdir(), 'token-gm-'));
  const opciones = () => ({ gm: null, perfiles: new Perfiles(join(dir, 'p.json')) });
  const r1: Msj[] = [];
  await new Gestor(repo, () => {}, opciones()).conectar({ enviar: (m) => r1.push(m as Msj) })
    .recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID }));
  const { codigo, token_gm } = r1.find((m) => m.tipo === 'sesion_creada')!;
  const guardada = (await repo.buscarSesionPorCodigo(codigo))!;
  assert.ok(guardada.gm_token_hash && guardada.gm_token_hash !== token_gm); // solo el hash

  const despues = new Gestor(repo, () => {}, opciones());
  const intruso: Msj[] = [];
  await despues.conectar({ enviar: (m) => intruso.push(m as Msj) }).recibir(JSON.stringify({ tipo: 'retomar_gm', codigo, token_gm: 'f'.repeat(32) }));
  assert.equal(intruso.at(-1)!.mensaje, 'Token de GM incorrecto');

  const gm: Msj[] = [];
  await despues.conectar({ enviar: (m) => gm.push(m as Msj) }).recibir(JSON.stringify({ tipo: 'retomar_gm', codigo, token_gm }));
  assert.equal(gm.find((m) => m.tipo === 'bienvenida')!.rol, 'gm');
  assert.ok(gm.some((m) => m.tipo === 'panel_gm'));
});
