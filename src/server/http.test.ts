import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { crearServidor, rutaGm } from './http.ts';
import { crearApi } from './api.ts';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { AlmacenMemoria } from './almacen.ts';
import { Perfiles } from '../ia/perfiles.ts';
import { DATOS_DEMO } from './demo.ts';

async function servir(ruta?: string) {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const perfiles = new Perfiles(join(mkdtempSync(join(tmpdir(), 'http-')), 'p.json'));
  const servidor = crearServidor(new Gestor(repo, () => {}), crearApi(repo, perfiles, new AlmacenMemoria()), { rutaGm: ruta });
  await new Promise<void>((listo) => servidor.listen(0, listo));
  const base = `http://localhost:${(servidor.address() as AddressInfo).port}`;
  return { base, cerrar: () => new Promise((r) => servidor.close(r)) };
}

test('la portada no ofrece dirigir partida; la ruta del GM sí', async () => {
  const { base, cerrar } = await servir();
  try {
    const portada = await (await fetch(`${base}/`)).text();
    assert.ok(!portada.includes('data-modo="gm"'));
    const gm = await (await fetch(`${base}/gm`)).text();
    assert.ok(gm.includes('<body data-modo="gm">'));
  } finally {
    await cerrar();
  }
});

test('GM_RUTA cambia la ruta; valores raros vuelven a /gm', async () => {
  assert.equal(rutaGm('/mi-mesa'), '/mi-mesa');
  for (const malo of [undefined, '', 'gm', '/../x', '/editor', '/A', '/x']) assert.equal(rutaGm(malo), '/gm', String(malo));
  const { base, cerrar } = await servir('/mi-mesa');
  try {
    assert.ok((await (await fetch(`${base}/mi-mesa`)).text()).includes('data-modo="gm"'));
    assert.equal((await fetch(`${base}/gm`)).status, 404);
  } finally {
    await cerrar();
  }
});
