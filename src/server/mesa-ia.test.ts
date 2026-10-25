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
