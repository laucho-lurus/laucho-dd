import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RollResult } from './dice.ts';
import {
  acercarse, ataquesPorTurno, conDesventaja, danoACaido, duplicarDados, elegirObjetivo, MUERTE_INICIAL, partesDeDano,
  resolverAtaque, salvacionDeMuerte, tirarPifia,
} from './combate.ts';

/** Dados trucados: devuelve los totales en orden y apunta las notaciones pedidas. */
function dados(valores: number[]) {
  const pedidas: string[] = [];
  const tirar = (n: string) => (pedidas.push(n), { notation: n, total: valores.shift()!, rolls: [], kept: [], modifier: 0 }) as RollResult;
  return { tirar, pedidas };
}

const daga = { nombre: 'Daga', ataque: '+4', dano: '1d4+2 perforante' };

test('ataque de monstruo: falla contra la CA, impacta y el 1 natural siempre falla', () => {
  assert.equal(resolverAtaque(daga, 18, dados([13]).tirar).texto, '17 vs CA 18, falla');
  const golpe = resolverAtaque(daga, 18, dados([14, 5]).tirar);
  assert.deepEqual([golpe.impacta, golpe.dano, golpe.texto], [true, 5, '18 vs CA 18, impacta, 5 de daño perforante']);
  assert.match(resolverAtaque({ ...daga, ataque: '+30' }, 10, dados([1]).tirar).texto, /1 natural, falla/);
});

test('crítico: el 20 natural impacta aunque no llegue y dobla los dados (no el modificador)', () => {
  const d = dados([20, 9]);
  const r = resolverAtaque({ ...daga, ataque: '-5' }, 30, d.tirar);
  assert.ok(r.critico && r.impacta);
  assert.deepEqual(d.pedidas, ['1d20', '2d4+2']);
  assert.equal(duplicarDados('2d6+3'), '4d6+3');
});

test('daño con varias partes y multiataque', () => {
  assert.deepEqual(partesDeDano('1d8+3 perforante + 2d8 veneno'), [{ dados: '1d8+3', tipo: 'perforante' }, { dados: '2d8', tipo: 'veneno' }]);
  assert.equal(ataquesPorTurno({ nombre: 'Cimitarra', ataque: '+5', dano: '1d6+3 cortante (tres ataques)' }), 3);
  assert.equal(ataquesPorTurno(daga), 1);
});

test('salvaciones de muerte: 3 éxitos estable, 3 fallos muerto, 1 natural son dos fallos, 20 despierta', () => {
  let m = MUERTE_INICIAL;
  for (const d of [12, 15, 10]) m = salvacionDeMuerte(m, d).muerte;
  assert.ok(m.estable && !m.muerto);
  const pifia = salvacionDeMuerte(MUERTE_INICIAL, 1);
  assert.equal(pifia.muerte.fallos, 2);
  assert.ok(salvacionDeMuerte(pifia.muerte, 5).muerte.muerto);
  assert.ok(salvacionDeMuerte(pifia.muerte, 20).despierta);
  const golpeado = danoACaido({ ...MUERTE_INICIAL, estable: true, exitos: 3 }, false);
  assert.deepEqual([golpeado.estable, golpeado.exitos, golpeado.fallos], [false, 0, 1]); // el daño rompe la estabilidad
  assert.ok(danoACaido({ ...MUERTE_INICIAL, fallos: 1 }, true).muerto);
});

test('pifias: tabla de 1d4 y desventaja en la próxima tirada', () => {
  assert.equal(tirarPifia(dados([2]).tirar).tipo, 'hiere_aliado');
  assert.equal(conDesventaja('1d20+5'), '2d20kl1+5');
  assert.equal(conDesventaja('1d8+3'), '1d8+3');
});

test('objetivo: el sugerido, si no el más cercano en el mapa, si no al azar; acercarse hasta quedar al lado', () => {
  const pjs = [{ id: 'a', pos: { x: 9, y: 9 } }, { id: 'b', pos: { x: 2, y: 1 } }];
  assert.equal(elegirObjetivo(pjs, { x: 0, y: 0 }, undefined, 0), 'b');
  assert.equal(elegirObjetivo(pjs, { x: 0, y: 0 }, 'a', 0), 'a');
  assert.equal(elegirObjetivo([{ id: 'a' }, { id: 'b' }], undefined, undefined, 0.9), 'b');
  assert.equal(elegirObjetivo([], undefined, undefined, 0), null);
  assert.deepEqual(acercarse({ x: 0, y: 0 }, { x: 5, y: 2 }, 6, () => true), { x: 4, y: 2 });
  assert.deepEqual(acercarse({ x: 0, y: 0 }, { x: 9, y: 0 }, 3, () => true), { x: 3, y: 0 });
});
