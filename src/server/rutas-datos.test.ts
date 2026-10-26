import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutasDatos } from './rutas-datos.ts';

test('sin variables usa data/ y uploads/ del repo', () => {
  const r = rutasDatos({});
  assert.match(r.gasto, /\/data\/gasto-ia\.json$/);
  assert.match(r.uploads.href, /\/uploads\/$/);
});

test('DATA_DIR lleva todo al volumen; UPLOADS_DIR manda sobre las imágenes', () => {
  const r = rutasDatos({ DATA_DIR: '/data' });
  assert.equal(r.perfiles, '/data/gm-perfiles.json');
  assert.equal(r.uploads.href, 'file:///data/uploads/');
  assert.equal(rutasDatos({ DATA_DIR: '/data', UPLOADS_DIR: '/img' }).uploads.href, 'file:///img/');
});
