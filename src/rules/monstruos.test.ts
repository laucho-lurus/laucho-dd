import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoMonstruo, monstruoPublico, plantillaDeCriatura, SRD_MONSTRUOS } from './monstruos.ts';

test('estado según PG: sano, herido, malherido, caído', () => {
  const e = (pg_actual: number) => estadoMonstruo({ pg_actual, pg_max: 10 });
  assert.deepEqual([10, 6, 5, 1, 0].map(e), ['sano', 'herido', 'malherido', 'malherido', 'caído']);
});

test('la vista pública no lleva cifras', () => {
  const m = { id: 'm1', nombre: 'Kobold 1', srd_clave: 'kobold', ca: 12, pg_max: 5, pg_actual: 3, ataques: [] };
  assert.deepEqual(monstruoPublico(m), { id: 'm1', nombre: 'Kobold 1', estado: 'herido', imagen_url: null });
});

test('kobold del SRD local y plantilla desde la tabla criaturas', () => {
  assert.deepEqual([SRD_MONSTRUOS.kobold.ca, SRD_MONSTRUOS.kobold.pg], [12, 5]);
  const grak = plantillaDeCriatura({ nombre: 'Grak', srd_clave: 'bugbear', stats: { ca: 16, pg: 27, ataques: [] } });
  assert.equal(grak?.nombre, 'Grak');
  assert.equal(plantillaDeCriatura({ nombre: 'X', srd_clave: null, stats: {} }), null);
});
