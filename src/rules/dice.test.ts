import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll, d20, modificador, caracteristicasAleatorias } from './dice.ts';

// RNG determinista: devuelve los valores en orden (cada uno en [0,1)).
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test('1d20+5 suma el modificador', () => {
  const r = roll('1d20+5', seq(0.7)); // 0.7*20 -> 14 + 1 = 15
  assert.deepEqual(r.rolls, [15]);
  assert.equal(r.total, 20);
});

test('4d6kh3 descarta la menor', () => {
  const r = roll('4d6kh3', seq(0, 0.5, 0.99, 0.2)); // 1, 4, 6, 2
  assert.deepEqual(r.rolls, [1, 4, 6, 2]);
  assert.deepEqual(r.kept.sort(), [2, 4, 6]);
  assert.equal(r.total, 12);
});

test('notación inválida lanza error', () => {
  assert.throws(() => roll('hola'));
  assert.throws(() => roll('0d6'));
});

test('ventaja toma el mayor y desventaja el menor', () => {
  assert.equal(d20(0, 'ventaja', seq(0.1, 0.9)).natural, 19);
  assert.equal(d20(0, 'desventaja', seq(0.1, 0.9)).natural, 3);
});

test('20 natural es crítico y 1 natural es pifia', () => {
  assert.equal(d20(3, 'normal', seq(0.99)).critico, true);
  assert.equal(d20(3, 'normal', seq(0)).pifia, true);
});

test('modificadores de característica', () => {
  assert.equal(modificador(10), 0);
  assert.equal(modificador(8), -1);
  assert.equal(modificador(17), 3);
});

test('seis características entre 3 y 18', () => {
  const c = caracteristicasAleatorias();
  assert.equal(c.length, 6);
  for (const v of c) assert.ok(v >= 3 && v <= 18);
});
