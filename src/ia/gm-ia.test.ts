import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { GmIa, promptContexto, promptSistema, type Acciones, type ClienteIa, type Contexto } from './gm-ia.ts';
import { costo } from './precios.ts';
import { Presupuesto } from './presupuesto.ts';
import { PERFILES_INICIALES } from './perfiles.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from '../server/demo.ts';

const campana = DATOS_DEMO.campanas!.find((c) => c.id === CAMPANA_DEMO_ID)!;
const jugador = {
  personaje_id: 'pj1', nombre: 'Brisa', raza: 'Mediana', clase: 'Pícara', nivel: 1,
  caracteristicas: { fue: 8, des: 17, con: 12, int: 13, sab: 12, car: 14 }, pg_max: 9, pg_actual: 9,
  inconsciente: false, tirada_pendiente: null, ca: 14, armas: [], imagen_url: null, conectado: true,
};
const contexto = (): Contexto => ({
  perfil: PERFILES_INICIALES[1],
  campana: { nombre: campana.nombre, resumen: campana.resumen!, diagrama: campana.diagrama! },
  nodo_actual: '1',
  variables: { antorchas_encendidas: false },
  jugadores: [jugador],
  eventos: [],
});

const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const respuesta = (bloques: unknown[], stop: string = 'tool_use') =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: bloques, stop_reason: stop, usage: uso }) as unknown as Anthropic.Message;
const herramienta = (name: string, input: unknown, id = name) => ({ type: 'tool_use', id, name, input });

/** Cliente falso que devuelve respuestas en orden y guarda las peticiones. */
function clienteFalso(respuestas: Anthropic.Message[]) {
  const peticiones: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = {
    crear: async (p) => {
      peticiones.push(structuredClone(p));
      const r = respuestas.shift();
      if (!r) throw new Error('sin más respuestas');
      return r;
    },
  };
  return { cliente, peticiones };
}

function accionesFalsas() {
  const hechas: string[] = [];
  const acciones: Acciones = {
    narrar: async (t) => (hechas.push(`narrar:${t}`), 'publicado'),
    pedirTirada: async (j, t, cd, m) => (hechas.push(`tirada:${j}:${t}:${cd}:${m}`), 'tirada pedida'),
    avanzarNodo: async (n) => (hechas.push(`nodo:${n}`), 'ok'),
    fijarVariable: async (n, v) => (hechas.push(`var:${n}=${v}`), 'ok'),
  };
  return { acciones, hechas };
}

const presupuesto = (tope = 5) => new Presupuesto(join(mkdtempSync(join(tmpdir(), 'gasto-')), 'gasto.json'), tope);

test('costo usa la tabla de precios (y la fila más cara si el modelo es desconocido)', () => {
  assert.equal(costo('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
  assert.equal(costo('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }), 0.2);
  assert.equal(costo('modelo-raro', { input_tokens: 0, output_tokens: 1_000_000 }), 10);
});

test('el prompt lleva perfil, nodo con notas y salidas, variables y fichas', () => {
  const s = promptSistema(PERFILES_INICIALES[1]);
  assert.match(s, /La Tabernera/);
  assert.match(s, /Nunca inventas resultados de dados/);
  const p = promptContexto(contexto(), 'Brisa entra al túnel');
  assert.match(p, /La boca de la mina/);
  assert.match(p, /Percepción CD 10/);
  assert.match(p, /a "2" \(La emboscada\)/);
  assert.match(p, /antorchas_encendidas/);
  assert.match(p, /Brisa \(id pj1\): Mediana Pícara 1, PG 9\/9, CA 14, FUE 8/);
  assert.match(p, /QUÉ PASÓ AHORA: Brisa entra al túnel/);
});

test('acción → pedir_tirada → narración, con system cacheado y sin pasar de 500 tokens', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([herramienta('pedir_tirada', { jugador: 'pj1', tirada: 'percepcion', cd: 10, motivo: 'Huellas' })]),
    respuesta([herramienta('narrar', { texto: 'Brisa se agacha junto a las huellas…' })], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'Brisa busca huellas', acciones, () => {});
  assert.deepEqual(hechas, ['tirada:pj1:percepcion:10:Huellas', 'narrar:Brisa se agacha junto a las huellas…']);
  assert.equal(peticiones[0].max_tokens, 500);
  assert.equal(peticiones[0].model, 'claude-haiku-5-5');
  assert.deepEqual((peticiones[0].system as Anthropic.TextBlockParam[])[0].cache_control, { type: 'ephemeral' });
  const segunda = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(segunda[0].content, 'tirada pedida');
});

test('avanzar_nodo a una salida inválida y variables inexistentes se rechazan', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([herramienta('avanzar_nodo', { nodo_id: '3' }, 'a'), herramienta('fijar_variable', { nombre: 'dragon', valor: true }, 'b')]),
    respuesta([herramienta('avanzar_nodo', { nodo_id: '2' }, 'c'), herramienta('fijar_variable', { nombre: 'antorchas_encendidas', valor: true }, 'd')], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  const rechazos = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.ok(rechazos.every((r) => r.is_error));
  assert.match(String(rechazos[0].content), /Salidas válidas: 2/);
  assert.deepEqual(hechas, ['nodo:2', 'var:antorchas_encendidas=true']);
});

test('si en una vuelta solo narró, no vuelve a llamar', async () => {
  const { cliente, peticiones } = clienteFalso([respuesta([herramienta('narrar', { texto: 'La escena…' })]), respuesta([])]);
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', accionesFalsas().acciones, () => {});
  assert.equal(peticiones.length, 1);
});

test('máximo 3 vueltas por disparador', async () => {
  const otra = () => respuesta([herramienta('fijar_variable', { nombre: 'antorchas_encendidas', valor: true })]);
  const { cliente, peticiones } = clienteFalso([otra(), otra(), otra(), otra()]);
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', accionesFalsas().acciones, () => {});
  assert.equal(peticiones.length, 3);
});

test('tope de gasto: avisa al 80 %, bloquea al 100 % y no vuelve a llamar', async () => {
  // Cada llamada cuesta 1000 × 0,1 + 200 × 0,5 = 200 por millón → 0,0002 USD. Tope 0,0005: 2 llamadas = 80 %.
  const p = presupuesto(0.0005);
  const avisos: string[] = [];
  const narra = () => respuesta([herramienta('narrar', { texto: 'hola' })], 'end_turn');
  const { cliente, peticiones } = clienteFalso([narra(), narra(), narra(), narra()]);
  const gm = new GmIa({ cliente, presupuesto: p });
  for (let i = 0; i < 4; i++) await gm.turno(async () => contexto(), 'x', accionesFalsas().acciones, (n) => avisos.push(n));
  assert.deepEqual(avisos, ['aviso', 'agotado', 'agotado']);
  assert.equal(peticiones.length, 3);
  assert.equal((await p.estado()).nivel, 'agotado');
});

test('el gasto se reinicia al cambiar de mes', async () => {
  let fecha = new Date('2026-10-31T23:00:00Z');
  const archivo = join(mkdtempSync(join(tmpdir(), 'gasto-')), 'g.json');
  await new Presupuesto(archivo, 5, () => fecha).registrar(4.5);
  fecha = new Date('2026-11-01T01:00:00Z');
  assert.equal((await new Presupuesto(archivo, 5, () => fecha).estado()).gastado, 0);
});
