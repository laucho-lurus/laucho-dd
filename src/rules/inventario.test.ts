import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beberPocion, bonoHabilidades, descanso, desequipar, equipar, leerInventario, otorgarHabilidad, otorgarItem, quitarItem, usarHabilidad, type Inventario } from './inventario.ts';
import { ataqueConArma, bonoCompetencia, claseArmadura, CATALOGO } from './items.ts';

let n = 0;
const id = () => `i${++n}`;
const vacio = (): Inventario => leerInventario({});
const car = { fue: 16, des: 14, con: 12, int: 10, sab: 10, car: 8 }; // FUE +3, DES +2
const ok = <T>(r: { ok: true; valor: T } | { ok: false; error: string }): T => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.valor;
};

test('catálogo SRD: armas, armaduras y pociones con sus datos', () => {
  assert.equal(CATALOGO.espada_larga.arma!.dano, '1d8');
  assert.equal(CATALOGO.placas.armadura!.ca_base, 18);
  assert.equal(CATALOGO.pocion_curacion.curacion, '2d4+2');
  assert.equal(CATALOGO.pocion_curacion_mayor.curacion, '4d4+4');
  assert.ok(CATALOGO.pocion_curacion_suprema.restringido);
  assert.deepEqual([1, 4, 5, 9].map(bonoCompetencia), [2, 2, 3, 4]);
});

test('equipar: armadura según categoría, escudo +2, FUE mínima y arma con su característica', () => {
  let inv = vacio();
  const cuero = ok(otorgarItem(inv, { item_id: 'cuero_tachonado' }, id));
  const placas = ok(otorgarItem(cuero.inv, { item_id: 'placas' }, id));
  const coraza = ok(otorgarItem(placas.inv, { item_id: 'coraza' }, id));
  const escudo = ok(otorgarItem(coraza.inv, { item_id: 'escudo' }, id));
  const estoque = ok(otorgarItem(escudo.inv, { item_id: 'estoque' }, id));
  inv = estoque.inv;
  assert.equal(claseArmadura(car, 12, inv.inventario, {}), 12); // sin armadura: la CA base del personaje
  assert.equal(claseArmadura(car, 12, inv.inventario, ok(equipar(inv, cuero.item.instancia, car)).equipo), 14); // 12 + DES 2
  assert.equal(claseArmadura({ ...car, des: 18 }, 12, inv.inventario, ok(equipar(inv, coraza.item.instancia, car)).equipo), 16); // 14 + máx. 2
  const conEscudo = ok(equipar(ok(equipar(inv, placas.item.instancia, car)), escudo.item.instancia, car));
  assert.equal(claseArmadura(car, 12, inv.inventario, conEscudo.equipo), 20); // placas 18 + escudo
  assert.match((equipar(inv, placas.item.instancia, { ...car, fue: 12 }) as { error: string }).error, /exige FUE 15/);
  assert.equal(desequipar(conEscudo, 'escudo').equipo.escudo, undefined);
  // estoque (sutil): la mejor de FUE y DES + competencia
  assert.deepEqual(ataqueConArma(car, 1, estoque.item), { nombre: 'Estoque', ataque: '+5', dano: '1d8+3 perforante', equipada: true });
  assert.equal(ataqueConArma(car, 5, estoque.item)!.ataque, '+6');
});

test('otorgar apila pociones; quitar desequipa; beber consume una', () => {
  const a = ok(otorgarItem(vacio(), { item_id: 'pocion_curacion', cantidad: 2 }, id));
  const b = ok(otorgarItem(a.inv, { item_id: 'pocion_curacion' }, id));
  assert.equal(b.inv.inventario.length, 1);
  assert.equal(b.inv.inventario[0].cantidad, 3);
  const bebida = ok(beberPocion(b.inv, b.inv.inventario[0].instancia));
  assert.equal(bebida.curacion, '2d4+2');
  assert.equal(bebida.inv.inventario[0].cantidad, 2);
  assert.equal(otorgarItem(vacio(), { item_id: 'excalibur' }, id).ok, false);
  assert.equal(otorgarItem(vacio(), { item_id: 'daga', cantidad: 0 }, id).ok, false);
  const espada = ok(otorgarItem(vacio(), { item_id: 'espada_larga' }, id));
  const equipada = ok(equipar(espada.inv, espada.item.instancia, car));
  assert.equal(ok(quitarItem(equipada, espada.item.instancia)).inv.equipo.arma, undefined);
  const custom = ok(otorgarItem(vacio(), { custom: { nombre: 'Llave de bronce', descripcion: 'Abre la forja' } }, id));
  assert.equal(custom.item.item_id, 'custom');
});

test('habilidades: usos por descanso, una vez, a voluntad y modificador simple', () => {
  const tomar = ok(otorgarHabilidad(vacio(), { rasgo_id: 'tomar_aliento' }, id));
  const usada = ok(usarHabilidad(tomar.inv, tomar.habilidad.instancia));
  assert.equal(usada.habilidad.usos_restantes, 0);
  assert.match((usarHabilidad(usada.inv, tomar.habilidad.instancia) as { error: string }).error, /descanso corto/);
  assert.equal(descanso(usada.inv, 'corto').habilidades[0].usos_restantes, 1);
  assert.equal(otorgarHabilidad(tomar.inv, { rasgo_id: 'tomar_aliento' }, id).ok, false); // no se repite

  const bendicion = ok(otorgarHabilidad(vacio(), { custom: { nombre: 'Bendición del molino', descripcion: '+1 a la CA', uso: 'a_voluntad', modificador: { a: 'ca', valor: 1 } } }, id));
  assert.equal(bonoHabilidades(bendicion.inv, 'ca'), 1);
  assert.equal(otorgarHabilidad(vacio(), { custom: { nombre: 'Trampa', uso: 'a_voluntad', modificador: { a: 'ataque', valor: 9 } } }, id).ok, false);
  const unica = ok(otorgarHabilidad(vacio(), { custom: { nombre: 'Deseo del pozo', uso: 'una_vez' } }, id));
  const gastada = ok(usarHabilidad(unica.inv, unica.habilidad.instancia));
  assert.equal(descanso(gastada.inv, 'largo').habilidades[0].usos_restantes, 0); // una vez: no vuelve con descanso
});
