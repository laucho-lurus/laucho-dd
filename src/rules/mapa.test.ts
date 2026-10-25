import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambiarNiebla, crearMapa, distancia, moverFicha, validarMovimiento, vistaJugadores, type Mapa } from './mapa.ts';

const mapa = () => {
  const m = crearMapa(20, 15) as Mapa;
  return moverFicha(moverFicha(m, 'brisa', { x: 2, y: 2 }), 'm1', { x: 5, y: 2 });
};

test('crear mapa: límites de tamaño y velocidad; al redimensionar se descarta lo que queda fuera', () => {
  assert.equal(typeof crearMapa(4, 10), 'string');
  assert.equal(typeof crearMapa(20, 15, 0), 'string');
  const chico = crearMapa(6, 6, 6, cambiarNiebla(mapa(), [{ x: 1, y: 1 }, { x: 10, y: 10 }], true)) as Mapa;
  assert.deepEqual(chico.fichas, { brisa: { x: 2, y: 2 }, m1: { x: 5, y: 2 } });
  assert.deepEqual(chico.ocultas, [7]); // (1,1) en un mapa de 6 de ancho
});

test('movimiento: velocidad (diagonal = 1 casilla), ocupada y fuera del mapa', () => {
  const m = mapa();
  assert.equal(distancia({ x: 0, y: 0 }, { x: 3, y: 4 }), 4);
  assert.equal(validarMovimiento(m, 'brisa', { x: 8, y: 8 }, false), null); // 6 casillas
  assert.match(validarMovimiento(m, 'brisa', { x: 9, y: 2 }, false)!, /Demasiado lejos: 7 casillas \(35 pies\)/);
  assert.equal(validarMovimiento(m, 'brisa', { x: 19, y: 14 }, true), null); // el GM no tiene límite
  assert.match(validarMovimiento(m, 'brisa', { x: 5, y: 2 }, true)!, /ocupada/);
  assert.match(validarMovimiento(m, 'brisa', { x: 20, y: 2 }, true)!, /fuera del mapa/);
  assert.match(validarMovimiento(m, 'brisa', { x: -1, y: 0 }, true)!, /fuera del mapa/);
  assert.equal(validarMovimiento(m, 'nueva', { x: 19, y: 14 }, false), null); // colocar por primera vez
});

test('niebla: los jugadores no ven monstruos en casillas ocultas; sí a los personajes', () => {
  const m = cambiarNiebla(cambiarNiebla(mapa(), [{ x: 5, y: 2 }, { x: 2, y: 2 }], true), [], false);
  const vista = vistaJugadores(m, (id) => id.startsWith('m'));
  assert.deepEqual(Object.keys(vista.fichas), ['brisa']);
  const revelado = vistaJugadores(cambiarNiebla(m, [{ x: 5, y: 2 }], false), (id) => id.startsWith('m'));
  assert.deepEqual(Object.keys(revelado.fichas).sort(), ['brisa', 'm1']);
});
