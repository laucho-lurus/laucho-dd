import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCampana, puedeConectar, validarDiagrama } from './diagrama.ts';
import * as molino from '../../db/seed/molino-datos.ts';
import type { Diagrama } from './aventura.ts';

test('El Molino Silencioso hace ida y vuelta sin perder nada (11 nodos, 16 flechas)', () => {
  const r = normalizarCampana(JSON.parse(JSON.stringify({ nombre: molino.NOMBRE_CAMPANA, diagrama: molino.diagrama, variables: molino.variables, resumen: molino.resumen })));
  assert.ok(r.ok);
  assert.equal(r.valor.diagrama.nodos.length, 11);
  assert.deepEqual(r.valor.diagrama, molino.diagrama);
  assert.deepEqual(r.valor.variables, molino.variables);
  assert.deepEqual(validarDiagrama(r.valor.diagrama, r.valor.variables), []);
});

test('los campos del editor (posición, tirada, combate, efectos) se conservan', () => {
  const diagrama = {
    nodos: [
      { id: 'a', tipo: 'tirada', titulo: 'Puente', texto: '', notas: '', x: 10.4, y: 20, chequeo: 'atletismo', cd: 15 },
      { id: 'b', tipo: 'combate', titulo: 'Kobolds', texto: '', notas: '', monstruos: [{ srd_clave: 'kobold', cantidad: 9 }] },
      { id: 'c', tipo: 'final', titulo: 'Fin', texto: '', notas: '', recompensas: '30 po', xp: 100 },
    ],
    flechas: [
      { desde: 'a', hasta: 'b', etiqueta: 'Éxito', efectos: [{ variable: 'cruzo', valor: true }] },
      { desde: 'b', hasta: 'c', etiqueta: 'Victoria', condicion: 'cruzo = true' },
    ],
  };
  const r = normalizarCampana({ nombre: 'X', diagrama, variables: { cruzo: false } });
  assert.ok(r.ok);
  const [a, b] = r.valor.diagrama.nodos;
  assert.deepEqual([a.x, a.chequeo, a.cd], [10, 'atletismo', 15]);
  assert.equal(b.monstruos![0].cantidad, 6); // tope de monstruos
  assert.deepEqual(r.valor.diagrama.flechas[0].efectos, [{ variable: 'cruzo', valor: true }]);
});

test('normalizar rechaza formas inválidas', () => {
  assert.equal(normalizarCampana({ nombre: '', diagrama: { nodos: [], flechas: [] } }).ok, false);
  assert.equal(normalizarCampana({ nombre: 'X', diagrama: { nodos: [{ tipo: 'escena' }], flechas: [] } }).ok, false);
  assert.equal(normalizarCampana({ nombre: 'X', diagrama: { nodos: [], flechas: [] }, variables: { 'mal nombre': 1 } }).ok, false);
});

const n = (id: string, tipo = 'escena') => ({ id, tipo, titulo: id.toUpperCase(), texto: '', notas: '' });

test('validación: nodo huérfano, sin salida, flecha rota, ids repetidos y sin final', () => {
  const d: Diagrama = {
    nodos: [n('1'), n('2'), n('2'), n('3')],
    flechas: [{ desde: '1', hasta: '2', etiqueta: '' }, { desde: '2', hasta: '9', etiqueta: '' }],
  };
  const avisos = validarDiagrama(d, {}).join('\n');
  assert.match(avisos, /Ids de nodo repetidos: 2/);
  assert.match(avisos, /Flecha rota: 2 → 9/);
  assert.match(avisos, /No hay ningún nodo final/);
  assert.match(avisos, /"3" no tiene entrada|"3" no tiene salida/);
  assert.match(avisos, /"3" no tiene entrada/);
});

test('reglas de conexión por tipo', () => {
  const d: Diagrama = {
    nodos: [n('t', 'tirada'), n('c', 'combate'), { ...n('d', 'decision'), opciones: ['Sí', 'No'] }, n('f', 'final'), n('a'), n('b'), n('e')],
    flechas: [{ desde: 't', hasta: 'a', etiqueta: 'Éxito' }, { desde: 't', hasta: 'b', etiqueta: 'Fracaso' }, { desde: 'd', hasta: 'a', etiqueta: 'Sí' }],
  };
  assert.match(puedeConectar(d, 't', 'e')!, /máximo 2/);
  assert.match(puedeConectar(d, 'f', 'a')!, /final no tiene salidas/);
  assert.match(puedeConectar(d, 'a', 'a')!, /consigo mismo/);
  assert.match(puedeConectar(d, 't', 'a')!, /ya existe/);
  assert.equal(puedeConectar(d, 'd', 'b'), null); // 2 opciones → 2 salidas
  assert.match(puedeConectar({ ...d, flechas: [...d.flechas, { desde: 'd', hasta: 'b', etiqueta: 'No' }] }, 'd', 'e')!, /máximo 2/);
  assert.equal(puedeConectar(d, 'c', 'f'), null);
});
