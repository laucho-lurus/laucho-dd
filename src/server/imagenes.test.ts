import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlmacenMemoria } from './almacen.ts';
import { borrarImagen, imagenesDeLaCampana, MAX_IMAGEN_GM_BYTES, subirImagen } from './imagenes.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';
import { clavePertenencia, sanear } from '../rules/imagenes.ts';
import * as molino from '../../db/seed/molino-datos.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const GIF = Buffer.from('GIF89a' + '\0'.repeat(16));
const dataUrl = (tipo: string, b: Buffer) => `data:image/${tipo};base64,${b.toString('base64')}`;

function preparar() {
  const repo = new RepositorioMemoria({
    ...DATOS_DEMO,
    campanas: [...DATOS_DEMO.campanas!, { id: 'molino', nombre: molino.NOMBRE_CAMPANA, diagrama: molino.diagrama, variables: molino.variables }],
  });
  return { repo, almacen: new AlmacenMemoria() };
}

test('pertenencia: tipos válidos, nombres saneados y campaña obligatoria para escenas, PNJ y fondos', () => {
  assert.equal(clavePertenencia({ tipo: 'criatura', clave: 'goblin' }), 'criatura:goblin');
  assert.equal(clavePertenencia({ tipo: 'pnj', clave: 'Tobías el Niño', campana_id: 'molino' }), 'pnj:molino:tobias-el-nino');
  assert.equal(clavePertenencia({ tipo: 'nodo', clave: '2b', campana_id: 'molino' }), 'nodo:molino:2b');
  assert.ok(typeof clavePertenencia({ tipo: 'nodo', clave: '1' }) === 'object');
  assert.ok(typeof clavePertenencia({ tipo: 'virus' as never, clave: 'x' }) === 'object');
  assert.ok(typeof clavePertenencia({ tipo: 'criatura', clave: '../etc/passwd' }) === 'object');
  assert.equal(sanear('  ¡Grak, el Osgo!  '), 'grak-el-osgo');
});

test('subida: valida el tipo real por la cabecera y el tamaño (5 MB)', async () => {
  const { repo, almacen } = preparar();
  const ok = await subirImagen(repo, almacen, { pertenece: { tipo: 'criatura', clave: 'goblin' }, imagen: dataUrl('png', PNG) });
  assert.ok(ok.ok);
  assert.match(ok.valor.url, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  const disfrazada = await subirImagen(repo, almacen, { pertenece: { tipo: 'criatura', clave: 'goblin' }, imagen: dataUrl('png', GIF) });
  assert.equal(disfrazada.ok, false);
  const grande = await subirImagen(repo, almacen, { pertenece: { tipo: 'criatura', clave: 'goblin' }, imagen: dataUrl('png', Buffer.concat([PNG, Buffer.alloc(MAX_IMAGEN_GM_BYTES)])) });
  assert.match((grande as { error: string }).error, /5 MB/);
  assert.equal(almacen.archivos.size, 1); // las rechazadas no dejan archivos
});

test('reemplazar borra el archivo anterior; borrar quita fila y archivo', async () => {
  const { repo, almacen } = preparar();
  const pertenece = { tipo: 'nodo', clave: '1', campana_id: 'molino' };
  const primera = await subirImagen(repo, almacen, { pertenece, imagen: dataUrl('png', PNG) });
  const segunda = await subirImagen(repo, almacen, { pertenece, imagen: dataUrl('png', PNG) });
  assert.ok(primera.ok && segunda.ok);
  assert.deepEqual([...almacen.archivos.keys()], [segunda.valor.url.slice('/uploads/'.length)]);
  assert.equal((await repo.listarImagenes(['nodo:molino:'])).length, 1);
  assert.ok(await borrarImagen(repo, almacen, segunda.valor.id));
  assert.equal(almacen.archivos.size, 0);
  assert.equal(await borrarImagen(repo, almacen, segunda.valor.id), false);
});

test('el retrato subido desde /imagenes se enlaza al personaje', async () => {
  const { repo, almacen } = preparar();
  const brisa = DATOS_DEMO.personajes![0].id;
  const r = await subirImagen(repo, almacen, { pertenece: { tipo: 'personaje', clave: brisa }, imagen: dataUrl('png', PNG) });
  assert.ok(r.ok);
  assert.equal((await repo.personajesDeCampana(CAMPANA_DEMO_ID))[0].imagen_url, r.valor.url);
  await borrarImagen(repo, almacen, r.valor.id);
  assert.equal((await repo.personajesDeCampana(CAMPANA_DEMO_ID))[0].imagen_url, null);
});

test('checklist de El Molino: escenas y monstruos, marcando las que ya tienen imagen', async () => {
  const { repo, almacen } = preparar();
  await subirImagen(repo, almacen, { pertenece: { tipo: 'nodo', clave: '1', campana_id: 'molino' }, imagen: dataUrl('png', PNG) });
  const datos = (await imagenesDeLaCampana(repo, 'molino'))!;
  const escenas = datos.pendientes.filter((p) => p.tipo === 'nodo');
  assert.equal(escenas.length, 9); // 11 nodos menos la decisión y la tirada
  assert.ok(escenas.find((p) => p.pertenece_a === 'nodo:molino:1')!.url);
  assert.equal(escenas.filter((p) => p.url).length, 1);
  assert.equal(datos.opciones.nodos.length, 11);
  assert.ok(datos.opciones.criaturas.some((c) => c.srd_clave === 'kobold'));
});
