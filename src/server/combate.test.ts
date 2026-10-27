// Enemigos que atacan, pifias, críticos y salvaciones de muerte, resueltos en el servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';
import { roll, type RollResult } from '../rules/dice.ts';
import { GmIa, type ClienteIa } from '../ia/gm-ia.ts';
import { Presupuesto } from '../ia/presupuesto.ts';
import { Perfiles } from '../ia/perfiles.ts';

const [BRISA, TORVALD] = DATOS_DEMO.personajes!.map((p) => p.id); // Brisa: 9 PG, CA 14 · Torvald: 13 PG, CA 18
type Msj = Record<string, any>;

/** Dados trucados: para cada notación que empiece por la clave, el siguiente TOTAL de la cola (ya con el modificador); si no, dados de verdad. */
function trucados(colas: Record<string, number[]>) {
  const pedidas: string[] = [];
  const tirar = (n: string): RollResult => {
    pedidas.push(n);
    const clave = Object.keys(colas).find((k) => n.startsWith(k) && colas[k].length);
    if (!clave) return roll(n);
    const total = colas[clave].shift()!;
    return { notation: n, total, rolls: [total], kept: [total], modifier: 0 };
  };
  return { tirar, pedidas };
}

function cliente(gestor: Gestor) {
  const recibidos: Msj[] = [];
  const c = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  return {
    recibidos,
    ultimo: () => recibidos.at(-1)!,
    estado: () => recibidos.findLast((m) => m.estado)!.estado,
    textos: () => recibidos.filter((m) => m.tipo === 'evento').map((m) => m.evento.datos?.texto ?? '').join('\n'),
    enviar: (m: Msj) => c.recibir(JSON.stringify(m)),
  };
}

async function mesa(colas: Record<string, number[]>, jugadores = [TORVALD], ia?: Anthropic.Message[]) {
  const dados = trucados(colas);
  const dir = mkdtempSync(join(tmpdir(), 'combate-'));
  let opcionesIa;
  if (ia) {
    const api: ClienteIa = { crear: async () => ia.shift() ?? Promise.reject(new Error('sin más respuestas')) };
    opcionesIa = { gm: new GmIa({ cliente: api, presupuesto: new Presupuesto(join(dir, 'g.json'), 5) }), perfiles: new Perfiles(join(dir, 'p.json')) };
  }
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {}, opcionesIa, { tirar: dados.tirar, azar: () => 0 });
  const gm = cliente(gestor);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, ...(ia && { gm_perfil_id: 'tabernera' }) });
  const codigo = gm.recibidos.find((m) => m.tipo === 'sesion_creada')!.codigo as string;
  await gestor.esperarIa(codigo);
  const pjs = [];
  for (const id of jugadores) {
    const j = cliente(gestor);
    await j.enviar({ tipo: 'unirse', codigo, personaje_id: id });
    pjs.push(j);
  }
  return { gestor, gm, pjs, codigo, dados };
}

const pj = (c: { estado: () => Msj }, id: string) => c.estado().jugadores.find((j: Msj) => j.personaje_id === id);

test('el monstruo entra en el orden y, con enemigos automáticos, ataca en su turno: impacta y el turno vuelve', async () => {
  const { gm, pjs: [torvald] } = await mesa({ '1d20': [14], '1d4': [5] });
  await gm.enviar({ tipo: 'opciones_combate', enemigos_auto: true });
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  assert.deepEqual(gm.estado().orden, [TORVALD, 'm1']);
  await torvald.enviar({ tipo: 'accion', texto: 'Me preparo' }); // sin IA no pasa nada más
  await gm.enviar({ tipo: 'siguiente_turno' });
  assert.match(torvald.textos(), /Kobold 1 ataca a Torvald: 18 vs CA 18, impacta, 5 de daño perforante/);
  assert.equal(pj(gm, TORVALD).pg_actual, 8);
  assert.deepEqual([gm.estado().turno_de, gm.estado().ronda], [TORVALD, 2]);
});

test('sin automático el GM decide: el turno espera al monstruo y el botón ataca; un fallo no hace daño', async () => {
  const { gm, pjs: [torvald] } = await mesa({ '1d20': [10] });
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await gm.enviar({ tipo: 'siguiente_turno' });
  assert.equal(gm.estado().turno_de, 'm1');
  assert.match(gm.estado().que_sigue, /Turno de Kobold 1/);
  await torvald.enviar({ tipo: 'accion', texto: 'Ataco' });
  assert.equal(torvald.ultimo().mensaje, 'No es tu turno');
  await gm.enviar({ tipo: 'atacar_monstruo', monstruo_id: 'm1' });
  assert.match(torvald.textos(), /Kobold 1 ataca a Torvald: 14 vs CA 18, falla/);
  assert.deepEqual([pj(gm, TORVALD).pg_actual, gm.estado().turno_de], [13, TORVALD]);
});

test('la CA con armadura equipada cuenta; un crítico dobla los dados', async () => {
  const { gm, pjs: [brisa] } = await mesa({ '1d20': [20], '2d4': [6] }, [BRISA]);
  await gm.enviar({ tipo: 'otorgar', personaje_id: BRISA, item: { item_id: 'cuero_tachonado' } });
  await brisa.enviar({ tipo: 'equipar', instancia: pj(gm, BRISA).inventario[0].instancia });
  assert.equal(pj(gm, BRISA).ca, 15); // 12 + DES 3
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await gm.enviar({ tipo: 'siguiente_turno' });
  await gm.enviar({ tipo: 'atacar_monstruo', monstruo_id: 'm1' });
  assert.match(brisa.textos(), /24 vs CA 15, ¡crítico! impacta, 6 de daño/);
});

test('multiataque: el capitán bandido ataca tres veces', async () => {
  const { gm, pjs: [torvald] } = await mesa({ '1d20': [2, 3, 4] });
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'bandit_captain', cantidad: 1 });
  await gm.enviar({ tipo: 'siguiente_turno' });
  await gm.enviar({ tipo: 'atacar_monstruo', monstruo_id: 'm1' });
  assert.equal(torvald.textos().match(/vs CA 18, falla/g)?.length, 3);
});

test('a 0 PG queda inconsciente, tira salvaciones de muerte al empezar su turno y el GM puede estabilizar', async () => {
  const { gm, pjs: [brisa] } = await mesa({ '1d20': [15, 12, 8], '1d4': [6] }, [BRISA, TORVALD]);
  await gm.enviar({ tipo: 'opciones_combate', enemigos_auto: true });
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: BRISA, cantidad: -3 }); // 6 PG
  await gm.enviar({ tipo: 'definir_orden', orden: [TORVALD, 'm1', BRISA] });
  await gm.enviar({ tipo: 'siguiente_turno' }); // kobold: 19 vs CA 14, 6 de daño → Brisa a 0; luego Brisa salva (12)
  assert.equal(pj(gm, BRISA).pg_actual, 0);
  assert.match(brisa.textos(), /Brisa cae inconsciente/);
  assert.match(brisa.textos(), /Brisa: salvación de muerte 12 \(éxito\): 1 éxitos, 0 fallos/);
  assert.deepEqual(pj(gm, BRISA).muerte, { exitos: 1, fallos: 0, estable: false, muerto: false });
  assert.equal(gm.estado().turno_de, TORVALD); // no puede actuar: el turno sigue
  await gm.enviar({ tipo: 'estabilizar', personaje_id: BRISA });
  assert.equal(pj(gm, BRISA).muerte.estable, true);
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: BRISA, cantidad: 4 });
  assert.equal(pj(gm, BRISA).muerte, null); // curado: vuelve
});

test('si cae todo el grupo se anuncia la derrota, salen los enemigos y el GM puede revivirlos', async () => {
  const { gm, pjs: [brisa] } = await mesa({ '1d20': [15, 5], '1d4': [4] }, [BRISA]);
  await gm.enviar({ tipo: 'opciones_combate', enemigos_auto: true });
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: BRISA, cantidad: -5 });
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await gm.enviar({ tipo: 'siguiente_turno' });
  assert.match(brisa.textos(), /Fin del combate: caída del grupo/);
  assert.deepEqual([gm.estado().monstruos, gm.estado().orden], [[], [BRISA]]);
  await gm.enviar({ tipo: 'revivir_grupo' });
  assert.deepEqual([pj(gm, BRISA).pg_actual, pj(gm, BRISA).muerte], [1, null]);
});

test('pifia del jugador (1 natural en un ataque): consecuencia de la tabla; desactivable por el GM', async () => {
  const { gm, pjs: [brisa] } = await mesa({ '1d20': [1, 1], '1d4': [1, 3] }, [BRISA]);
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: BRISA, notacion: '1d20+5', objetivo_monstruo: 'm1', efecto: 'ataque' });
  await brisa.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.match(brisa.textos(), /¡Pifia! Brisa se golpea a sí mismo: 3 de daño/);
  assert.equal(pj(gm, BRISA).pg_actual, 6);
  await gm.enviar({ tipo: 'opciones_combate', pifias: false });
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: BRISA, notacion: '1d20+5', objetivo_monstruo: 'm1', efecto: 'ataque' });
  await brisa.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.equal(pj(gm, BRISA).pg_actual, 6);
});

test('crítico del jugador (20 natural en el ataque): el daño siguiente dobla los dados', async () => {
  const { gm, pjs: [brisa], dados } = await mesa({ '1d20': [20] }, [BRISA]);
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'bugbear', cantidad: 1 });
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: BRISA, notacion: '1d20+5', objetivo_monstruo: 'm1', efecto: 'ataque' });
  await brisa.enviar({ tipo: 'tirar', notacion: '1d20' });
  await gm.enviar({ tipo: 'pedir_tirada', personaje_id: BRISA, notacion: '1d8+3', objetivo_monstruo: 'm1', efecto: 'daño' });
  await brisa.enviar({ tipo: 'tirar', notacion: '1d20' });
  assert.ok(dados.pedidas.includes('2d8+3'));
});

test('con GM IA: al pasar el turno el monstruo ataca, la IA recibe el resultado y "Deshacer IA" lo revierte', async () => {
  const usar = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}`, name, input });
  const r = (bloques: unknown[], stop = 'tool_use') => ({ content: bloques, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;
  const { gestor, gm, pjs: [torvald], codigo } = await mesa({ '1d20': [16], '1d4': [6] }, [TORVALD], [
    r([usar('narrar', { texto: 'Torvald se cubre.' }), usar('pasar_turno', {})]),
    r([], 'end_turn'),
  ]);
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await torvald.enviar({ tipo: 'accion', texto: 'Me cubro' });
  await gestor.esperarIa(codigo);
  assert.equal(pj(gm, TORVALD).pg_actual, 7); // 20 vs 18: impacta, 6
  assert.equal(gm.estado().turno_de, TORVALD);
  await gm.enviar({ tipo: 'deshacer_ia' });
  assert.equal(pj(gm, TORVALD).pg_actual, 13);
});
