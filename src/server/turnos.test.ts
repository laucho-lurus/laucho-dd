// Turnos y fin de combate: la IA pasa el turno, se saltan los inconscientes y los monstruos caídos salen.
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
import { roll } from '../rules/dice.ts';

// d20 fijo en 10: las salvaciones de muerte no levantan a nadie por azar.
const tirar = (n: string) => (n === '1d20' ? { notation: n, total: 10, rolls: [10], kept: [10], modifier: 0 } : roll(n));

const [BRISA, TORVALD, ILYRA] = DATOS_DEMO.personajes!.map((p) => p.id);
type Msj = Record<string, any>;

const respuesta = (bloques: unknown[], stop = 'tool_use') =>
  ({ content: bloques, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } }) as unknown as Anthropic.Message;
const usar = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}-${Math.random()}`, name, input });
const fin = respuesta([], 'end_turn');

async function mesa(respuestas: Anthropic.Message[], jugadores = [BRISA, TORVALD]) {
  const dir = mkdtempSync(join(tmpdir(), 'turnos-'));
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = {
    crear: async (p) => {
      llamadas.push(structuredClone(p));
      const r = respuestas.shift();
      if (!r) throw new Error('sin más respuestas');
      return r;
    },
  };
  const gm = new GmIa({ cliente, presupuesto: new Presupuesto(join(dir, 'gasto.json'), 5) });
  const gestor = new Gestor(new RepositorioMemoria(DATOS_DEMO), () => {}, { gm, perfiles: new Perfiles(join(dir, 'perfiles.json')) }, { tirar });
  const conectar = () => {
    const recibidos: Msj[] = [];
    const c = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
    return { recibidos, enviar: (m: Msj) => c.recibir(JSON.stringify(m)), estado: () => recibidos.findLast((m) => m.estado)!.estado };
  };
  const humano = conectar();
  await humano.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID, gm_perfil_id: 'tabernera' });
  const codigo = humano.recibidos.find((m) => m.tipo === 'sesion_creada')!.codigo as string;
  await gestor.esperarIa(codigo); // bienvenida
  const sentados = [];
  for (const id of jugadores) {
    const j = conectar();
    await j.enviar({ tipo: 'unirse', codigo, personaje_id: id });
    sentados.push(j);
  }
  return { gestor, humano, jugadores: sentados, codigo, llamadas };
}

const textos = (c: { recibidos: Msj[] }) => c.recibidos.filter((m) => m.tipo === 'evento').map((m) => m.evento.datos?.texto ?? m.evento.datos?.cambio);

test('la IA pasa el turno con su herramienta y todos lo ven', async () => {
  const { gestor, humano, jugadores: [brisa, torvald], codigo, llamadas } = await mesa([
    respuesta([usar('narrar', { texto: 'Brisa abre la puerta.' }), usar('pasar_turno', {})]),
    fin,
  ]);
  assert.equal(humano.estado().turno_de, BRISA);
  await brisa.enviar({ tipo: 'accion', texto: 'Abro la puerta' });
  await gestor.esperarIa(codigo);
  for (const c of [humano, brisa, torvald]) assert.equal(c.estado().turno_de, TORVALD);
  assert.match(textos(torvald).join('\n'), /Turno de Torvald/);
  // La IA ve de quién es el turno en su contexto.
  assert.match(JSON.stringify(llamadas[0].messages), /Turno de Brisa \(ronda 1\)/);
});

test('el inconsciente tira su salvación de muerte y el turno sigue; cuenta la ronda', async () => {
  const { humano } = await mesa([], [BRISA, TORVALD, ILYRA]);
  await humano.enviar({ tipo: 'aplicar_pg', personaje_id: TORVALD, cantidad: -99 });
  await humano.enviar({ tipo: 'siguiente_turno' });
  assert.equal(humano.estado().turno_de, ILYRA);
  await humano.enviar({ tipo: 'siguiente_turno' });
  assert.equal(humano.estado().turno_de, BRISA);
  assert.equal(humano.estado().ronda, 2);
});

test('en combate, si la IA resuelve la acción y olvida pasar el turno, lo pasa el servidor', async () => {
  const { gestor, humano, jugadores: [brisa, torvald], codigo } = await mesa([
    respuesta([usar('narrar', { texto: 'Brisa esquiva al kobold.' })], 'end_turn'),
    respuesta([usar('pedir_tirada', { jugador: TORVALD, tirada: 'atletismo', motivo: 'Empujar al kobold al pozo' })], 'end_turn'),
  ]);
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 1 });
  await brisa.enviar({ tipo: 'accion', texto: 'Me aparto' });
  await gestor.esperarIa(codigo);
  assert.equal(humano.estado().turno_de, TORVALD);
  // Con una tirada pendiente del que actúa, el turno no se mueve hasta que se resuelva.
  await torvald.enviar({ tipo: 'accion', texto: 'Empujo al kobold' });
  await gestor.esperarIa(codigo);
  assert.equal(humano.estado().turno_de, TORVALD);
});

test('un monstruo a 0 PG queda caído; cuando caen todos, el combate termina y se anuncia', async () => {
  const { humano, jugadores: [brisa] } = await mesa([]);
  await humano.enviar({ tipo: 'agregar_monstruos', srd_clave: 'kobold', cantidad: 2 });
  const [m1, m2] = humano.estado().monstruos;
  await humano.enviar({ tipo: 'monstruo_pg', monstruo_id: m1.id, cantidad: -99 });
  assert.equal(humano.estado().monstruos.find((m: Msj) => m.id === m1.id).estado, 'caído');
  // El GM puede revivirlo mientras dura el combate.
  await humano.enviar({ tipo: 'monstruo_pg', monstruo_id: m1.id, cantidad: 2 });
  assert.notEqual(humano.estado().monstruos.find((m: Msj) => m.id === m1.id).estado, 'caído');
  await humano.enviar({ tipo: 'monstruo_pg', monstruo_id: m1.id, cantidad: -99 });
  await humano.enviar({ tipo: 'monstruo_pg', monstruo_id: m2.id, cantidad: -99 });
  assert.deepEqual(brisa.estado().monstruos, []);
  assert.match(textos(brisa).join('\n'), /Combate terminado/);
});

test('al sentarse, el personaje recibe las habilidades de su clase (también en femenino)', async () => {
  const { humano } = await mesa([]);
  const brisa = humano.estado().jugadores.find((j: Msj) => j.personaje_id === BRISA); // Pícara
  assert.deepEqual(brisa.habilidades.map((h: Msj) => h.rasgo_id), ['ataque_furtivo', 'accion_astuta']);
});
