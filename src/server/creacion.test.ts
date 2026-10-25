import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPersonaje, leerImagen, MAX_IMAGEN_BYTES, TiradasCaracteristicas } from './creacion.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { Gestor } from './gestor.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const dataUrl = (tipo: string, b: Buffer) => `data:image/${tipo};base64,${b.toString('base64')}`;

function preparar() {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const archivos = new Map<string, Buffer>();
  const tiradas = new TiradasCaracteristicas();
  const deps = { repo, tiradas, guardarArchivo: async (n: string, c: Buffer) => void archivos.set(n, c) };
  return { repo, archivos, tiradas, deps };
}

const base = {
  nombre: 'Aldric',
  raza: 'enano', // +2 CON
  clase: 'guerrero', // d10
  trasfondo: 'Soldado',
  alineamiento: 'Legal bueno',
  descripcion: 'Barba trenzada.',
  campana_id: CAMPANA_DEMO_ID,
  metodo: 'estandar',
  caracteristicas: { fue: 15, des: 14, con: 13, int: 8, sab: 12, car: 10 },
};

test('crea un personaje con bonos raciales, PG y CA derivados', async () => {
  const { deps, repo } = preparar();
  const r = await crearPersonaje(deps, base);
  assert.ok(r.ok);
  assert.equal(r.valor.caracteristicas.con, 15);
  assert.equal(r.valor.pg_max, 12); // 10 + mod CON 15 (+2)
  assert.equal(r.valor.pg_actual, 12);
  assert.equal(r.valor.datos.ca, 12); // 10 + mod DES 14 (+2)
  assert.equal(r.valor.raza, 'Enano');
  assert.ok((await repo.personajesDeCampana(CAMPANA_DEMO_ID)).some((p) => p.nombre === 'Aldric'));
});

test('rechaza datos fuera de las listas o del método', async () => {
  const { deps } = preparar();
  for (const malo of [
    { ...base, nombre: '  ' },
    { ...base, raza: 'orco' },
    { ...base, clase: 'toString' },
    { ...base, alineamiento: 'Bueno' },
    { ...base, campana_id: 'otra' },
    { ...base, metodo: 'magia' },
    { ...base, caracteristicas: { ...base.caracteristicas, fue: 18 } },
    { ...base, metodo: 'custom', caracteristicas: { ...base.caracteristicas, fue: 21 } },
  ]) {
    const r = await crearPersonaje(deps, malo);
    assert.equal(r.ok, false, JSON.stringify(malo));
  }
});

test('aleatorio: solo vale con los valores tirados por el servidor, y una vez', async () => {
  const { deps, tiradas } = preparar();
  const { token, valores } = tiradas.tirar();
  assert.equal(valores.length, 6);
  assert.ok(valores.every((v) => v >= 3 && v <= 18));
  const [fue, des, con, int, sab, car] = valores;
  const pedido = { ...base, metodo: 'aleatorio', token_tiradas: token, caracteristicas: { fue: car, des: sab, con: int, int: con, sab: des, car: fue } };

  const trampa = await crearPersonaje(deps, { ...pedido, caracteristicas: { ...pedido.caracteristicas, fue: 19 } });
  assert.equal(trampa.ok, false);
  assert.ok((await crearPersonaje(deps, pedido)).ok);
  assert.equal((await crearPersonaje(deps, pedido)).ok, false); // token ya consumido
});

test('las tiradas vencen', () => {
  let ahora = 0;
  const tiradas = new TiradasCaracteristicas(() => ahora);
  const { token } = tiradas.tirar();
  ahora = 31 * 60_000;
  assert.equal(tiradas.ver(token), undefined);
});

test('foto: acepta PNG pequeño y lo enlaza al personaje', async () => {
  const { deps, archivos } = preparar();
  const r = await crearPersonaje(deps, { ...base, imagen: dataUrl('png', PNG) });
  assert.ok(r.ok);
  assert.equal(r.valor.imagen_url, `/uploads/${r.valor.id}.png`);
  assert.ok(archivos.has(`${r.valor.id}.png`));
});

test('foto: rechaza más de 2 MB, tipos no permitidos y contenido falso', () => {
  const grande = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGEN_BYTES)]);
  assert.match((leerImagen(dataUrl('png', grande)) as { error: string }).error, /2 MB/);
  assert.equal(leerImagen(dataUrl('gif', PNG)).ok, false);
  assert.equal(leerImagen(dataUrl('png', Buffer.from('<svg onload=alert(1)>'))).ok, false);
  assert.equal(leerImagen('no es una imagen').ok, false);
  assert.ok(leerImagen(dataUrl('webp', Buffer.concat([Buffer.from('RIFF0000WEBP'), Buffer.alloc(8)]))).ok);
});

test('un personaje creado con la sala abierta aparece al unirse, y los PG se guardan', async () => {
  const { deps, repo } = preparar();
  const gestor = new Gestor(repo, () => {});
  const recibidos: any[] = [];
  const gm = gestor.conectar({ enviar: (m) => recibidos.push(m) });
  await gm.recibir(JSON.stringify({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID }));
  const codigo = recibidos.at(-1).codigo;

  const r = await crearPersonaje(deps, base);
  assert.ok(r.ok);
  const j: any[] = [];
  const jugador = gestor.conectar({ enviar: (m) => j.push(m) });
  await jugador.recibir(JSON.stringify({ tipo: 'unirse', codigo, personaje_id: r.valor.id }));
  assert.ok(j.some((m) => m.tipo === 'bienvenida'));

  await gm.recibir(JSON.stringify({ tipo: 'aplicar_pg', personaje_id: r.valor.id, cantidad: -4 }));
  const enRepo = (await repo.personajesDeCampana(CAMPANA_DEMO_ID)).find((p) => p.id === r.valor.id)!;
  assert.equal(enRepo.pg_actual, 8);
});
