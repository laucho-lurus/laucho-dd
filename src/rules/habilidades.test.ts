import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HABILIDADES, modificador, tiradaDeChequeo } from './habilidades.ts';

const car = { fue: 16, des: 8, con: 10, int: 11, sab: 13, car: 20 };

test('modificador de característica', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 12, 20].map(modificador), [-5, -1, -1, 0, 0, 1, 5]);
});

test('hay 18 habilidades', () => {
  assert.equal(Object.keys(HABILIDADES).length, 18);
});

test('habilidad usa el modificador de su característica', () => {
  assert.deepEqual(tiradaDeChequeo('atletismo', car), { notacion: '1d20+3', motivo: 'Atletismo' });
  assert.deepEqual(tiradaDeChequeo('sigilo', car), { notacion: '1d20-1', motivo: 'Sigilo' });
  assert.deepEqual(tiradaDeChequeo('historia', car), { notacion: '1d20', motivo: 'Historia' });
  assert.deepEqual(tiradaDeChequeo('persuasion', car), { notacion: '1d20+5', motivo: 'Persuasión' });
});

test('salvación usa la característica indicada', () => {
  assert.deepEqual(tiradaDeChequeo('salvacion_sab', car), { notacion: '1d20+1', motivo: 'Salvación de Sabiduría' });
});

test('clave desconocida devuelve null', () => {
  assert.equal(tiradaDeChequeo('volar', car), null);
  assert.equal(tiradaDeChequeo('salvacion_xyz', car), null);
  assert.equal(tiradaDeChequeo('toString', car), null);
});
