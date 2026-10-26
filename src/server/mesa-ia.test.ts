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
    { id: 'm1', nombre: 'Kobold 1', estado: 'sano', imagen_url: null },
    { id: 'm2', nombre: 'Kobold 2', estado: 'sano', imagen_url: null },
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
  assert.deepEqual(r2.find((m) => m.tipo === 'bienvenida')!.estado.monstruos, [{ id: 'm1', nombre: 'Lobo 1', estado: 'malherido', imagen_url: null }]);
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

test('3b: flechas con efectos y condición, monstruos del nodo de combate y contexto de tirada para la IA', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'editor-juego-'));
  const campana = {
    id: 'c-editor',
    nombre: 'Prueba del editor',
    variables: { llave: false, alarma: false },
    diagrama: {
      introduccion: '{heroes} llegan a la puerta.',
      nodos: [
        { id: '1', tipo: 'tirada', titulo: 'La puerta', texto: '', notas: '', chequeo: 'atletismo', cd: 14 },
        { id: '2', tipo: 'combate', titulo: 'Emboscada', texto: '', notas: '', monstruos: [{ srd_clave: 'kobold', cantidad: 2 }] },
        { id: '3', tipo: 'final', titulo: 'Tesoro', texto: '', notas: '' },
      ],
      flechas: [
        { desde: '1', hasta: '2', etiqueta: 'Éxito', efectos: [{ variable: 'alarma', valor: true }] },
        { desde: '2', hasta: '3', etiqueta: 'Victoria', condicion: 'llave = true' },
      ],
    },
  };
  const repo = new RepositorioMemoria({ campanas: [campana], personajes: DATOS_DEMO.personajes!.map((p) => ({ ...p, campana_id: 'c-editor' })) });
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const guion = [
    respuesta([usar('avanzar_nodo', { nodo_id: '2' })]),
    respuesta([usar('avanzar_nodo', { nodo_id: '3' })]),
    respuesta([usar('narrar', { texto: 'Necesitáis la llave.' })], 'end_turn'),
  ];
  const gm = new GmIa({ cliente: { crear: async (p) => (llamadas.push(p), guion.shift()!) }, presupuesto: new Presupuesto(join(dir, 'g.json'), 5) });
  const gestor = new Gestor(repo, () => {}, { gm, perfiles: new Perfiles(join(dir, 'p.json')) });
  const r: Msj[] = [];
  const humano = gestor.conectar({ enviar: (m) => r.push(m as Msj) });
  await humano.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: 'c-editor', gm_perfil_id: 'cronista' }));
  const codigo = r.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await humano.recibir(JSON.stringify({ tipo: 'narrar_escena' }));
  await gestor.esperarIa(codigo);

  // (b) la IA ve la habilidad y la CD configuradas
  assert.match(llamadas[0].messages[0].content as string, /Tirada configurada: atletismo, CD 14 \(secreta/);
  const panel = () => r.filter((m) => m.tipo === 'panel_gm').at(-1)!;
  // (c) efecto de la flecha 1→2 y (a) kobolds al entrar al combate
  assert.equal(panel().nodo.id, '2');
  assert.deepEqual(panel().variables, { llave: false, alarma: true });
  assert.deepEqual(panel().monstruos.map((m: Msj) => m.nombre), ['Kobold 1', 'Kobold 2']);
  // (c) la IA no puede cruzar 2→3 sin la llave…
  const rechazo = (llamadas[2].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0].content;
  assert.match(String(rechazo), /No se cumple la condición de esa salida: llave = true/);
  // …pero el GM humano sí puede saltar
  await humano.recibir(JSON.stringify({ tipo: 'cambiar_nodo', nodo_id: '3' }));
  assert.equal(panel().nodo.id, '3');
  // deshacer IA quita los kobolds que salieron al entrar en el combate
  await humano.recibir(JSON.stringify({ tipo: 'deshacer_ia' }));
  assert.equal(panel().monstruos.length, 0);
});

test('mapa: cada jugador mueve solo su ficha con su velocidad, el GM mueve todo y la niebla oculta monstruos', async () => {
  const { gestor, humano, jugador, codigo } = await mesa([], false);
  const TORVALD = DATOS_DEMO.personajes![1].id;
  await gestor.conectar({ enviar: () => {} }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: TORVALD }));
  await jugador.enviar({ tipo: 'mapa_configurar', ancho: 20, alto: 15, velocidad: 6 });
  assert.equal(jugador.ultimo().mensaje, 'Solo el GM puede hacer eso');
  await humano.enviar({ tipo: 'mapa_configurar', ancho: 20, alto: 15, velocidad: 6 });
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await humano.enviar({ tipo: 'mover_ficha', id: 'm1', x: 10, y: 5 });
  await humano.enviar({ tipo: 'mover_ficha', id: TORVALD, x: 3, y: 3 });

  await jugador.enviar({ tipo: 'mover_ficha', id: BRISA, x: 1, y: 1 }); // colocar
  await jugador.enviar({ tipo: 'mover_ficha', id: BRISA, x: 9, y: 1 });
  assert.match(jugador.ultimo().mensaje, /Demasiado lejos: 8 casillas \(40 pies\)/);
  await jugador.enviar({ tipo: 'mover_ficha', id: BRISA, x: 3, y: 3 });
  assert.match(jugador.ultimo().mensaje, /ocupada/);
  await jugador.enviar({ tipo: 'mover_ficha', id: TORVALD, x: 4, y: 4 });
  assert.match(jugador.ultimo().mensaje, /tu propia ficha/);
  await jugador.enviar({ tipo: 'mover_ficha', id: BRISA, x: 7, y: 1 });
  assert.deepEqual(jugador.ultimo().estado.mapa.fichas[BRISA], { x: 7, y: 1 });

  await humano.enviar({ tipo: 'niebla', celdas: [{ x: 10, y: 5 }, { x: 7, y: 1 }], oculta: true });
  const visto = jugador.ultimo().estado.mapa;
  assert.ok(!('m1' in visto.fichas)); // el kobold queda oculto…
  assert.ok(BRISA in visto.fichas); // …pero los personajes no
  assert.ok('m1' in humano.recibidos.filter((m) => m.tipo === 'mapa_gm').at(-1)!.mapa.fichas); // el GM lo ve todo
  await humano.enviar({ tipo: 'quitar_monstruo', monstruo_id: 'm1' });
  assert.ok(!('m1' in humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!.mapa.fichas));
});

test('mapa: se guarda y vuelve tras reiniciar; el fondo solo acepta imágenes subidas', async () => {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const dir = mkdtempSync(join(tmpdir(), 'mapa-'));
  const opciones = () => ({ gm: null, perfiles: new Perfiles(join(dir, 'p.json')) });
  const r1: Msj[] = [];
  const gm = new Gestor(repo, () => {}, opciones()).conectar({ enviar: (m) => r1.push(m as Msj) });
  await gm.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID }));
  const codigo = r1.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await gm.recibir(JSON.stringify({ tipo: 'mapa_configurar', ancho: 12, alto: 10, velocidad: 5 }));
  await gm.recibir(JSON.stringify({ tipo: 'mapa_fondo', url: 'https://malicioso.example/x.png' }));
  assert.match(r1.at(-1)!.mensaje, /Fondo inválido/);
  await gm.recibir(JSON.stringify({ tipo: 'mapa_fondo', url: '/uploads/11111111-1111-4111-8111-111111111111.png' }));
  await gm.recibir(JSON.stringify({ tipo: 'niebla', celdas: [{ x: 0, y: 0 }], oculta: true }));

  const r2: Msj[] = [];
  await new Gestor(repo, () => {}, opciones()).conectar({ enviar: (m) => r2.push(m as Msj) }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: BRISA }));
  const mapa = r2.find((m) => m.tipo === 'bienvenida')!.estado.mapa;
  assert.deepEqual([mapa.ancho, mapa.alto, mapa.velocidad, mapa.ocultas, mapa.fondo_url], [12, 10, 5, [0], '/uploads/11111111-1111-4111-8111-111111111111.png']);
});

test('imágenes en partida: el monstruo lleva su imagen, oculta bajo la niebla; el GM muestra la escena', async () => {
  const { gestor, humano, jugador, codigo } = await mesa([], false);
  const repo = (gestor as unknown as { repo: RepositorioMemoria }).repo;
  await repo.registrarImagen('criatura:kobold', 'uploads/22222222-2222-4222-8222-222222222222.png');
  await repo.registrarImagen(`nodo:${CAMPANA_DEMO_ID}:1`, 'uploads/33333333-3333-4333-8333-333333333333.png');
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  assert.equal(jugador.ultimo().estado.monstruos[0].imagen_url, '/uploads/22222222-2222-4222-8222-222222222222.png');

  await humano.enviar({ tipo: 'mapa_configurar', ancho: 10, alto: 10, velocidad: 6 });
  await humano.enviar({ tipo: 'mover_ficha', id: 'm1', x: 4, y: 4 });
  await humano.enviar({ tipo: 'niebla', celdas: [{ x: 4, y: 4 }], oculta: true });
  assert.deepEqual(jugador.ultimo().estado.monstruos, []); // bajo la niebla tampoco sale en la fila de enemigos

  const panel = humano.recibidos.filter((m) => m.tipo === 'panel_gm').at(-1)!;
  assert.deepEqual(panel.imagenes_nodo, [{ nombre: 'Escena: La boca de la mina', url: '/uploads/33333333-3333-4333-8333-333333333333.png' }]);
  await humano.enviar({ tipo: 'mostrar_imagen', url: panel.imagenes_nodo[0].url, titulo: 'La boca de la mina' });
  assert.equal(eventos(jugador).at(-1).datos.cambio, 'imagen');
  await humano.enviar({ tipo: 'mostrar_imagen', url: 'javascript:alert(1)' });
  assert.equal(humano.ultimo().mensaje, 'Imagen inválida');
  await jugador.enviar({ tipo: 'mostrar_imagen', url: panel.imagenes_nodo[0].url });
  assert.equal(jugador.ultimo().mensaje, 'Solo el GM puede hacer eso');
  void codigo;
});

test('introducción: el GM la muestra con los nombres reales, puede editarla y la IA la recibe como contexto', async () => {
  const { gestor, humano, jugador, codigo, llamadas } = await mesa([respuesta([usar('narrar', { texto: 'La mina os espera.' })], 'end_turn')]);
  // narrar_escena la muestra antes de la primera narración (sin coste) y la IA la recibe como ya leída
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  const intro = eventos(jugador).find((e) => e.datos.cambio === 'introduccion');
  assert.match(intro.datos.texto, /^Brisa esperan en la plaza de Piedragris/);
  assert.match(llamadas[0].messages[0].content as string, /Introducción \(ya leída a los jugadores; no la repitas ni la contradigas\): Brisa esperan/);
  assert.equal(llamadas.length, 1);
  // editada por el GM para esta sesión y vuelta a mostrar
  await humano.enviar({ tipo: 'mostrar_introduccion', texto: '{heroes} despiertan en una celda. {héroe_1} tiene la llave.' });
  assert.equal(eventos(jugador).at(-1).datos.texto, 'Brisa despiertan en una celda. Brisa tiene la llave.');
  await jugador.enviar({ tipo: 'mostrar_introduccion' });
  assert.equal(jugador.ultimo().mensaje, 'Solo el GM puede hacer eso');
});

test('introducción: si la campaña no tiene, la IA la escribe una vez y se guarda en la sesión', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intro-ia-'));
  const repo = new RepositorioMemoria({ campanas: [{ id: 'sin', nombre: 'Sin intro', resumen: 'Ratas en el sótano.', diagrama: { nodos: [{ id: '1', tipo: 'escena', titulo: 'El sótano', texto: 'Huele a queso.', notas: '' }], flechas: [] } }] });
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = { crear: async (p) => (llamadas.push(p), { content: [{ type: 'text', text: '{heroes} bajan al sótano de la posada del Queso Feliz.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 20 } } as unknown as Anthropic.Message) };
  const opciones = () => ({ gm: new GmIa({ cliente, presupuesto: new Presupuesto(join(dir, 'g.json'), 5) }), perfiles: new Perfiles(join(dir, 'p.json')) });
  const g1 = new Gestor(repo, () => {}, opciones());
  const r: Msj[] = [];
  await g1.conectar({ enviar: (m) => r.push(m as Msj) }).recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: 'sin', gm_perfil_id: 'cronista' }));
  const codigo = r.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await g1.esperarIa(codigo);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].max_tokens, 300);
  assert.equal(llamadas[0].tools, undefined);
  assert.equal(r.filter((m) => m.tipo === 'panel_gm').at(-1)!.introduccion.plantilla, '{heroes} bajan al sótano de la posada del Queso Feliz.');
  // tras reiniciar no se vuelve a generar
  assert.equal((await repo.buscarSesionPorCodigo(codigo))!.introduccion, '{heroes} bajan al sótano de la posada del Queso Feliz.');
  const g2 = new Gestor(repo, () => {}, opciones());
  await g2.conectar({ enviar: () => {} }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: 'x' }));
  assert.equal(llamadas.length, 1);
});

test('objetos: la IA da uno acotado y "Deshacer IA" lo retira', async () => {
  const { gestor, humano, jugador, codigo } = await mesa([
    respuesta([usar('otorgar_item', { personaje: BRISA, item_id: 'pocion_curacion', cantidad: 2, motivo: 'cofre del sótano' })]),
    respuesta([usar('narrar', { texto: 'Dos frascos rojos.' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'narrar_escena' });
  await gestor.esperarIa(codigo);
  assert.equal(eventos(jugador).find((e) => e.datos.cambio === 'inventario').datos.texto, 'Brisa recibe 2 × Poción de curación.');
  assert.equal(jugador.ultimo().estado.jugadores[0].inventario[0].cantidad, 2);
  await humano.enviar({ tipo: 'deshacer_ia' });
  assert.deepEqual(jugador.ultimo().estado.jugadores[0].inventario, []);
  assert.match(eventos(humano).at(-1).datos.texto, /objetos retirados/);
});

test('recompensas del nodo: se entregan al llegar y se anuncian', async () => {
  const demo = DATOS_DEMO.campanas![0];
  const campana = {
    ...demo,
    diagrama: { ...demo.diagrama!, nodos: demo.diagrama!.nodos.map((n) => (n.id === '3' ? { ...n, items: [{ item_id: 'monedas_oro', cantidad: 30 }, { item_id: 'pocion_curacion', cantidad: 1 }] } : n)) },
  };
  const gestor = new Gestor(new RepositorioMemoria({ ...DATOS_DEMO, campanas: [campana] }), () => {});
  const recibidos: Msj[] = [];
  const gm = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  await gm.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID }));
  const codigo = recibidos.find((m) => m.tipo === 'sesion_creada')!.codigo;
  await gestor.conectar({ enviar: () => {} }).recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: BRISA }));
  await gm.recibir(JSON.stringify({ tipo: 'cambiar_nodo', nodo_id: '3' }));
  const textos = eventos({ recibidos }).filter((e) => e.datos.cambio === 'inventario').map((e) => e.datos.texto);
  assert.deepEqual(textos, ['Brisa recibe 30 × Monedas de oro.', 'Brisa recibe Poción de curación.']);
  assert.equal(recibidos.at(-1)!.estado.jugadores[0].inventario.length, 2);
});
