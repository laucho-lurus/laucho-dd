import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listaNombres, rellenarIntroduccion } from './introduccion.ts';

const plantilla = '{heroes} se encuentran en la plaza de Robleda. {héroe_1} lleva la carta del rey.';

test('sustitución de nombres: sin héroes, 1, 2 y 3 o más', () => {
  assert.equal(listaNombres([]), 'los héroes');
  assert.equal(rellenarIntroduccion(plantilla, []), 'los héroes se encuentran en la plaza de Robleda. un aventurero lleva la carta del rey.');
  assert.equal(rellenarIntroduccion(plantilla, ['Brisa']), 'Brisa se encuentran en la plaza de Robleda. Brisa lleva la carta del rey.');
  assert.equal(listaNombres(['Brisa', 'Torvald']), 'Brisa y Torvald');
  assert.equal(listaNombres(['Brisa', 'Torvald', 'Ilyra']), 'Brisa, Torvald y Ilyra');
  assert.equal(listaNombres(['A', 'B', 'C', 'D']), 'A, B, C y D');
});

test('{heroe_N} sin tilde y fuera de rango; los nombres vacíos no cuentan', () => {
  assert.equal(rellenarIntroduccion('{heroe_2} y {héroe_5}', ['Brisa', 'Torvald']), 'Torvald y un aventurero');
  assert.equal(listaNombres(['  ', 'Brisa']), 'Brisa');
  assert.equal(rellenarIntroduccion('Sin marcas.', ['Brisa']), 'Sin marcas.');
});
