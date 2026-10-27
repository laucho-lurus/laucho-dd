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
  inventario: [], habilidades: [], equipo: {},
  hechizos: [], pm: 0, pm_max: 0, xp: 0, xp_siguiente: 300,
};
const contexto = (): Contexto => ({
  perfil: PERFILES_INICIALES[1],
  campana: { nombre: campana.nombre, resumen: campana.resumen!, diagrama: campana.diagrama! },
  nodo_actual: '1',
  variables: { antorchas_encendidas: false },
  jugadores: [jugador],
  eventos: [],
  permitir_pg: true,
  introduccion: null,
  monstruos: [],
  criaturas: [{ srd_clave: 'kobold', nombre: 'Kobold' }],
  turno_de: null,
  ronda: 1,
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
    pedirTirada: async (j, t, cd, m, o) => (hechas.push(`tirada:${j}:${t}:${cd}:${m}${o.objetivo_monstruo ? `:${o.objetivo_monstruo}:${o.efecto}` : ''}`), 'tirada pedida'),
    agregarMonstruos: async (k, n) => (hechas.push(`monstruos:${k}:${n}`), 'ok'),
    avanzarNodo: async (n) => (hechas.push(`nodo:${n}`), 'ok'),
    fijarVariable: async (n, v) => (hechas.push(`var:${n}=${v}`), 'ok'),
    aplicarPg: async (p, n, m) => (hechas.push(`pg:${p}:${n}:${m}`), 'ok'),
    otorgarItem: async (p, i, n, m) => (hechas.push(`item:${p}:${i}:${n}:${m}`), 'ok'),
    pasarTurno: async () => (hechas.push('turno'), 'ok'),
    otorgarXp: async (p, n, m) => (hechas.push(`xp:${p}:${n}:${m}`), 'ok'),
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

test('narrar + pedir_tirada: 1 sola llamada, 1 narración y 1 tirada; sin texto de cierre', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([
      { type: 'text', text: 'Voy a narrar y pedir una tirada.' },
      herramienta('narrar', { texto: 'El barro guarda huellas pequeñas…' }),
      herramienta('pedir_tirada', { jugador: 'pj1', tirada: 'percepcion', cd: 10, motivo: 'Huellas' }),
    ]),
    respuesta([{ type: 'text', text: 'La narración está publicada y pedí una tirada.' }], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'Brisa busca huellas', acciones, () => {});
  assert.deepEqual(hechas, ['narrar:El barro guarda huellas pequeñas…', 'tirada:pj1:percepcion:10:Huellas']);
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].max_tokens, 500);
  assert.equal(peticiones[0].model, 'claude-haiku-5-5');
  assert.deepEqual((peticiones[0].system as Anthropic.TextBlockParam[])[0].cache_control, { type: 'ephemeral' });
  assert.match(promptSistema(PERFILES_INICIALES[0]), /Nunca escribas texto fuera de las herramientas/);
});

test('el texto de cierre tras herramientas no se publica, y solo se narra una vez', async () => {
  const { cliente } = clienteFalso([
    respuesta([herramienta('avanzar_nodo', { nodo_id: '2' }, 'a'), herramienta('narrar', { texto: 'Uno' }, 'b'), herramienta('narrar', { texto: 'Dos' }, 'c')]),
    respuesta([{ type: 'text', text: 'Listo, avancé y narré.' }], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['nodo:2', 'narrar:Uno']);
});

test('si responde solo con texto (sin herramientas), se publica como narración', async () => {
  const { cliente } = clienteFalso([respuesta([{ type: 'text', text: 'La mina cruje.' }], 'end_turn')]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['narrar:La mina cruje.']);
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

test('aplicar_pg: aplica, respeta 25 por llamada y 2 por intervención', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([
      herramienta('aplicar_pg', { personaje: 'pj1', cantidad: -30, motivo: 'caída' }, 'a'),
      herramienta('aplicar_pg', { personaje: 'otro', cantidad: -3, motivo: 'x' }, 'b'),
      herramienta('aplicar_pg', { personaje: 'pj1', cantidad: -4, motivo: 'mordisco' }, 'c'),
      herramienta('aplicar_pg', { personaje: 'pj1', cantidad: 2, motivo: 'poción' }, 'd'),
      herramienta('aplicar_pg', { personaje: 'pj1', cantidad: -1, motivo: 'otra' }, 'e'),
    ]),
    respuesta([], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['pg:pj1:-4:mordisco', 'pg:pj1:2:poción']);
  const r = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.deepEqual(r.map((x) => Boolean(x.is_error)), [true, true, false, false, true]);
  assert.match(String(r[4].content), /2 veces/);
  assert.match(promptSistema(PERFILES_INICIALES[0]), /solo tras una tirada ya resuelta/);
});

test('otorgar_item: 1 por intervención, sin objetos fuertes ni oro desmedido', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([
      herramienta('otorgar_item', { personaje: 'pj1', item_id: 'pocion_curacion_suprema', motivo: 'cofre' }, 'a'),
      herramienta('otorgar_item', { personaje: 'pj1', item_id: 'monedas_oro', cantidad: 500, motivo: 'cofre' }, 'b'),
      herramienta('otorgar_item', { personaje: 'pj1', item_id: 'espada_larga', cantidad: 2, motivo: 'cofre' }, 'c'),
      herramienta('otorgar_item', { personaje: 'pj1', item_id: 'monedas_oro', cantidad: 30, motivo: 'paga del molinero' }, 'd'),
      herramienta('otorgar_item', { personaje: 'pj1', item_id: 'antorcha', motivo: 'otra' }, 'e'),
    ]),
    respuesta([], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['item:pj1:monedas_oro:30:paga del molinero']);
  const r = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.deepEqual(r.map((x) => Boolean(x.is_error)), [true, true, true, false, true]);
});

test('con la casilla apagada la herramienta no se ofrece y se rechaza', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([herramienta('aplicar_pg', { personaje: 'pj1', cantidad: -2, motivo: 'x' })]),
    respuesta([], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => ({ ...contexto(), permitir_pg: false }), 'x', acciones, () => {});
  assert.ok(!peticiones[0].tools!.some((t) => 'name' in t && t.name === 'aplicar_pg'));
  assert.deepEqual(hechas, []);
});

test('pedir_tirada sin motivo: pide reintento una vez y luego usa una etiqueta por defecto', async () => {
  const { cliente, peticiones } = clienteFalso([
    respuesta([herramienta('pedir_tirada', { jugador: 'pj1', tirada: '1d8+3' }, 'a')]),
    respuesta([herramienta('pedir_tirada', { jugador: 'pj1', tirada: '1d8+3', motivo: 'daño' }, 'b')]),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  const primero = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(primero[0].is_error, true);
  assert.match(String(primero[0].content), /motivo concreto/);
  assert.deepEqual(hechas, ['tirada:pj1:1d8+3:null:Daño']);
  assert.equal(peticiones.length, 2);
});

test('pedir_tirada con motivo claro pasa a la primera; las habilidades no lo necesitan', async () => {
  const { cliente } = clienteFalso([
    respuesta([
      herramienta('pedir_tirada', { jugador: 'pj1', tirada: '1d20+5', motivo: 'Ataque con arco al kobold más cercano' }, 'a'),
      herramienta('pedir_tirada', { jugador: 'pj1', tirada: 'sigilo' }, 'b'),
    ]),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => contexto(), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['tirada:pj1:1d20+5:null:Ataque con arco al kobold más cercano', 'tirada:pj1:sigilo:null:null']);
});

test('el prompt exige narrar el resultado sin inventar cifras, pedir el daño y decir qué sigue', () => {
  const s = promptSistema(PERFILES_INICIALES[0]);
  assert.match(s, /usando solo el número y el éxito o fracaso que te da el servidor/);
  assert.match(s, /sin inventar cifras de daño ni PG de monstruos/);
  assert.match(s, /si fue un ataque exitoso y falta el daño, pide la tirada de daño con su motivo/);
  assert.match(s, /quién actúa a continuación o qué debe hacer el jugador/);
});

test('el contexto lista armas, objetos, habilidades y el turno; la regla pide negar lo que no tienen', () => {
  const ficha = {
    ...jugador,
    armas: [{ nombre: 'Estoque', ataque: '+5', dano: '1d8+3 perforante' }],
    inventario: [{ instancia: 'i1', item_id: 'pocion_curacion', nombre: 'Poción de curación', tipo: 'pocion' as const, cantidad: 2, descripcion: '' }],
    habilidades: [{ instancia: 'h1', rasgo_id: 'ataque_furtivo', nombre: 'Ataque furtivo', descripcion: '', uso: 'a_voluntad' as const, usos_max: 0, usos_restantes: 0 }],
  };
  const p = promptContexto({ ...contexto(), jugadores: [ficha], turno_de: 'pj1', ronda: 3 }, 'x');
  assert.match(p, /Armas: Estoque \+5 1d8\+3 perforante\. Objetos: Poción de curación ×2\. Habilidades: Ataque furtivo\. Hechizos: ninguno\. XP 0\./);
  assert.match(p, /Turno de Brisa \(ronda 3\)/);
  assert.match(promptSistema(PERFILES_INICIALES[0]), /niégalo dentro de la ficción/);
});

test('pasar_turno una vez por intervención; daño sin objetivo con monstruos vivos se rechaza', async () => {
  const kobold = { id: 'm1', nombre: 'Kobold 1', srd_clave: 'kobold', ca: 12, pg_max: 5, pg_actual: 5, ataques: [], imagen_url: null };
  const { cliente, peticiones } = clienteFalso([
    respuesta([
      herramienta('pedir_tirada', { jugador: 'pj1', tirada: '1d8+3', motivo: 'Daño del estoque al kobold', efecto: 'daño' }, 'a'),
      herramienta('pasar_turno', {}, 'b'),
      herramienta('pasar_turno', {}, 'c'),
    ]),
    respuesta([], 'end_turn'),
  ]);
  const { acciones, hechas } = accionesFalsas();
  await new GmIa({ cliente, presupuesto: presupuesto() }).turno(async () => ({ ...contexto(), monstruos: [kobold] }), 'x', acciones, () => {});
  assert.deepEqual(hechas, ['turno']);
  const r = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.match(String(r[0].content), /objetivo_monstruo/);
  assert.deepEqual(r.map((x) => Boolean(x.is_error)), [true, false, true]);
});
