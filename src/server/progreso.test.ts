import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';

const [, TORVALD, ILYRA] = DATOS_DEMO.personajes!.map((p) => p.id);
type Msj = Record<string, any>;

// Ilyra (Maga, INT 17): PM máx. 1 + 3 + 2 = 6.
const datos = () => ({
  ...DATOS_DEMO,
  personajes: DATOS_DEMO.personajes!.map((p) => (p.id === ILYRA ? { ...p, datos: { ...p.datos, hechizos: ['proyectil_magico', 'descarga_de_fuego'] } } : p)),
});

function cliente(gestor: Gestor) {
  const recibidos: Msj[] = [];
  const c = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  return {
    recibidos,
    ultimo: () => recibidos.at(-1)!,
    estado: () => recibidos.findLast((m) => m.estado)!.estado,
    textos: () => recibidos.filter((m) => m.tipo === 'evento').map((m) => m.evento.datos?.texto ?? ''),
    enviar: (m: Msj) => c.recibir(JSON.stringify(m)),
  };
}

async function mesa(repo = new RepositorioMemoria(datos())) {
  const gestor = new Gestor(repo, () => {});
  const gm = cliente(gestor);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID });
  const codigo = gm.ultimo().codigo as string;
  const ilyra = cliente(gestor);
  await ilyra.enviar({ tipo: 'unirse', codigo, personaje_id: ILYRA });
  const torvald = cliente(gestor);
  await torvald.enviar({ tipo: 'unirse', codigo, personaje_id: TORVALD });
  return { repo, gm, ilyra, torvald };
}

const jugador = (c: { estado: () => Msj }, id: string) => c.estado().jugadores.find((j: Msj) => j.personaje_id === id);

test('lanzar: valida turno, hechizo conocido y maná; descuenta PM y daña al monstruo', async () => {
  const { gm, ilyra, torvald } = await mesa();
  assert.deepEqual([jugador(gm, ILYRA).pm, jugador(gm, ILYRA).pm_max], [6, 6]);
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'bugbear', cantidad: 1 });
  const osgo = gm.estado().monstruos[0].id;
  await torvald.enviar({ tipo: 'lanzar', hechizo_id: 'proyectil_magico' });
  assert.equal(torvald.ultimo().mensaje, 'No es tu turno');
  await ilyra.enviar({ tipo: 'lanzar', hechizo_id: 'curar_heridas' });
  assert.equal(ilyra.ultimo().mensaje, 'No conoces Curar heridas');
  for (let i = 0; i < 3; i++) await ilyra.enviar({ tipo: 'lanzar', hechizo_id: 'proyectil_magico', objetivo_monstruo: osgo });
  assert.equal(jugador(gm, ILYRA).pm, 0);
  assert.match(ilyra.textos().join('\n'), /Ilyra lanza Proyectil mágico \(−2 PM\) sobre Osgo 1: \d+ de fuerza/);
  await ilyra.enviar({ tipo: 'lanzar', hechizo_id: 'proyectil_magico' });
  assert.match(ilyra.ultimo().mensaje, /No te alcanza el maná/);
  // 3 proyectiles = 3 × (3d4+3) ≥ 18 de 27 PG: el osgo está herido o caído.
  assert.ok(gm.estado().monstruos.length === 0 || gm.estado().monstruos[0].estado !== 'sano');
  await ilyra.enviar({ tipo: 'lanzar', hechizo_id: 'descarga_de_fuego' }); // los trucos no cuestan
  assert.equal(ilyra.ultimo().tipo, 'evento');
});

test('descanso: corto devuelve la mitad una vez, largo todo; el GM ajusta PM', async () => {
  const { gm, ilyra } = await mesa();
  await gm.enviar({ tipo: 'ajustar_pm', personaje_id: ILYRA, cantidad: -6 });
  await gm.enviar({ tipo: 'descanso', descanso: 'corto' });
  assert.equal(jugador(gm, ILYRA).pm, 3);
  assert.match(ilyra.textos().at(-1)!, /Maná: Ilyra \+3 PM/);
  await gm.enviar({ tipo: 'descanso', descanso: 'corto' });
  assert.equal(jugador(gm, ILYRA).pm, 3);
  await gm.enviar({ tipo: 'descanso', descanso: 'largo' });
  assert.equal(jugador(gm, ILYRA).pm, 6);
  await gm.enviar({ tipo: 'ajustar_pm', personaje_id: TORVALD, cantidad: 2 });
  assert.equal(gm.ultimo().mensaje, 'Torvald no lanza hechizos');
});

test('XP: el GM la da, el personaje sube de nivel con PG y PM, y se guarda', async () => {
  const { repo, gm, ilyra } = await mesa();
  await gm.enviar({ tipo: 'dar_xp', personaje_id: ILYRA, cantidad: 300 });
  const j = jugador(gm, ILYRA);
  assert.deepEqual([j.nivel, j.xp, j.xp_siguiente, j.pg_max, j.pm_max], [2, 300, 900, 12, 7]); // 7 + (6/2 + 1 + 1)
  assert.match(ilyra.textos().at(-1)!, /¡Ilyra sube al nivel 2! \+5 PG \(12 máx\.\), 7 PM máx\., competencia \+2\./);
  const guardada = (await repo.personajesDeCampana(CAMPANA_DEMO_ID)).find((p) => p.id === ILYRA)!;
  assert.deepEqual([guardada.nivel, guardada.pg_max, guardada.datos.xp], [2, 12, 300]);
});

test('al terminar el combate se reparte la XP de los caídos', async () => {
  const { gm } = await mesa();
  await gm.enviar({ tipo: 'agregar_monstruos', srd_clave: 'goblin', cantidad: 2 }); // 2 × 50
  for (const m of gm.estado().monstruos) await gm.enviar({ tipo: 'monstruo_pg', monstruo_id: m.id, cantidad: -99 });
  assert.deepEqual([jugador(gm, ILYRA).xp, jugador(gm, TORVALD).xp], [50, 50]);
  assert.match(gm.recibidos.filter((m) => m.tipo === 'evento').map((m) => m.evento.datos.texto).join('\n'), /Torvald gana 50 XP/);
});
