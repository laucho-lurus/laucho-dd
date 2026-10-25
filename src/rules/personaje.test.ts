import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarBonos, CLASES, derivados, RAZAS, validarCaracteristicas } from './personaje.ts';

const car = (fue: number, des: number, con: number, int: number, sab: number, carisma: number) =>
  ({ fue, des, con, int, sab, car: carisma });

test('arreglo estándar: acepta una permutación y rechaza repetidos', () => {
  assert.equal(validarCaracteristicas('estandar', car(8, 15, 14, 10, 12, 13)), null);
  assert.ok(validarCaracteristicas('estandar', car(15, 15, 14, 10, 12, 13)));
});

test('compra de puntos: 27 como máximo y valores 8–15', () => {
  assert.equal(validarCaracteristicas('compra', car(15, 15, 15, 8, 8, 8)), null); // 27
  assert.match(validarCaracteristicas('compra', car(15, 15, 15, 9, 8, 8))!, /28 puntos/);
  assert.ok(validarCaracteristicas('compra', car(16, 8, 8, 8, 8, 8)));
  assert.ok(validarCaracteristicas('compra', car(7, 8, 8, 8, 8, 8)));
});

test('custom: 3 a 20 y enteros', () => {
  assert.equal(validarCaracteristicas('custom', car(3, 20, 10, 10, 10, 10)), null);
  assert.ok(validarCaracteristicas('custom', car(2, 10, 10, 10, 10, 10)));
  assert.ok(validarCaracteristicas('custom', car(21, 10, 10, 10, 10, 10)));
  assert.ok(validarCaracteristicas('custom', car(10.5, 10, 10, 10, 10, 10)));
});

test('aleatorio: solo los valores tirados por el servidor, en cualquier orden', () => {
  const tiradas = [16, 12, 9, 14, 11, 7];
  assert.equal(validarCaracteristicas('aleatorio', car(7, 9, 11, 12, 14, 16), tiradas), null);
  assert.ok(validarCaracteristicas('aleatorio', car(18, 9, 11, 12, 14, 16), tiradas));
  assert.ok(validarCaracteristicas('aleatorio', car(7, 9, 11, 12, 14, 16)));
});

test('bonos raciales, con tope 20', () => {
  assert.deepEqual(aplicarBonos(car(10, 10, 10, 10, 10, 19), RAZAS.tiefling), car(10, 10, 10, 11, 10, 20));
  assert.deepEqual(aplicarBonos(car(10, 10, 10, 10, 10, 10), RAZAS.humano), car(11, 11, 11, 11, 11, 11));
});

test('PG = dado de golpe + mod CON; CA = 10 + mod DES', () => {
  const d = derivados(car(16, 14, 15, 8, 10, 12), CLASES.guerrero);
  assert.equal(d.pg_max, 12);
  assert.equal(d.ca, 12);
  assert.deepEqual(d.armas[0], { nombre: 'Espada larga', ataque: '+5', dano: '1d8+3' });
  assert.equal(derivados(car(10, 8, 3, 10, 10, 10), CLASES.mago).pg_max, 2);
  assert.equal(derivados(car(10, 8, 3, 10, 10, 10), CLASES.mago).ca, 9);
});
