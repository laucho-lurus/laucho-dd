import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gestor } from './gestor.ts';
import { RepositorioMemoria } from './repositorio-memoria.ts';
import { CAMPANA_DEMO_ID, DATOS_DEMO } from './demo.ts';

const [BRISA, TORVALD] = DATOS_DEMO.personajes!.map((p) => p.id);

type Msj = Record<string, any>;

function cliente(gestor: Gestor) {
  const recibidos: Msj[] = [];
  const conexion = gestor.conectar({ enviar: (m) => recibidos.push(m as Msj) });
  return {
    recibidos,
    ultimo: () => recibidos.at(-1)!,
    estado: () => recibidos.findLast((m) => m.estado)!.estado,
    enviar: (m: Msj) => conexion.recibir(JSON.stringify(m)),
  };
}

async function mesa(repo = new RepositorioMemoria(DATOS_DEMO)) {
  const gestor = new Gestor(repo, () => {});
  const gm = cliente(gestor);
  await gm.enviar({ tipo: 'crear_sesion', campana_id: CAMPANA_DEMO_ID });
  const codigo = gm.ultimo().codigo as string;
  const brisa = cliente(gestor);
  await brisa.enviar({ tipo: 'unirse', codigo, personaje_id: BRISA });
  const torvald = cliente(gestor);
  await torvald.enviar({ tipo: 'unirse', codigo, personaje_id: TORVALD });
  return { repo, gm, brisa, torvald };
}

const jugadorDe = (estado: Msj, id: string) => estado.jugadores.find((j: Msj) => j.personaje_id === id);
const instancia = (estado: Msj, id: string, item_id: string) => jugadorDe(estado, id).inventario.find((i: Msj) => i.item_id === item_id).instancia;

test('el GM otorga y quita ítems; la mesa lo ve anunciado', async () => {
  const { gm, brisa } = await mesa();
  await gm.enviar({ tipo: 'otorgar', personaje_id: TORVALD, item: { item_id: 'espada_larga' } });
  assert.equal(brisa.ultimo().evento.datos.texto, 'Torvald recibe Espada larga.');
  const inst = instancia(gm.estado(), TORVALD, 'espada_larga');
  await gm.enviar({ tipo: 'quitar', personaje_id: TORVALD, instancia: inst, es: 'item' });
  assert.equal(jugadorDe(gm.estado(), TORVALD).inventario.length, 0);
  // Un jugador no puede otorgarse cosas.
  await brisa.enviar({ tipo: 'otorgar', personaje_id: BRISA, item: { item_id: 'placas' } });
  assert.equal(brisa.ultimo().tipo, 'error');
});

test('equipar armadura y escudo cambia la CA; el arma, el ataque', async () => {
  const { gm, torvald, brisa } = await mesa();
  for (const item_id of ['cota_de_malla', 'escudo']) await gm.enviar({ tipo: 'otorgar', personaje_id: TORVALD, item: { item_id } });
  await gm.enviar({ tipo: 'otorgar', personaje_id: BRISA, item: { item_id: 'estoque' } });
  await torvald.enviar({ tipo: 'equipar', instancia: instancia(gm.estado(), TORVALD, 'cota_de_malla') });
  assert.equal(jugadorDe(gm.estado(), TORVALD).ca, 16); // pesada: sin DES
  await torvald.enviar({ tipo: 'equipar', instancia: instancia(gm.estado(), TORVALD, 'escudo') });
  assert.equal(jugadorDe(gm.estado(), TORVALD).ca, 18);
  await torvald.enviar({ tipo: 'desequipar', ranura: 'escudo' });
  assert.equal(jugadorDe(gm.estado(), TORVALD).ca, 16);

  await brisa.enviar({ tipo: 'equipar', instancia: instancia(gm.estado(), BRISA, 'estoque') });
  const arma = jugadorDe(gm.estado(), BRISA).armas[0];
  assert.deepEqual(arma, { nombre: 'Estoque', ataque: '+5', dano: '1d8+3 perforante', equipada: true }); // sutil: DES +3, competencia +2

  // Nadie equipa el inventario ajeno.
  await brisa.enviar({ tipo: 'equipar', personaje_id: TORVALD, instancia: instancia(gm.estado(), TORVALD, 'escudo') });
  assert.equal(brisa.ultimo().mensaje, 'Solo puedes usar tu propio inventario');
});

test('la poción cura con tope en PG máximos y se gasta', async () => {
  const { gm, brisa } = await mesa();
  await gm.enviar({ tipo: 'otorgar', personaje_id: BRISA, item: { item_id: 'pocion_curacion', cantidad: 2 } });
  await gm.enviar({ tipo: 'aplicar_pg', personaje_id: BRISA, cantidad: -1 });
  await brisa.enviar({ tipo: 'usar_item', instancia: instancia(gm.estado(), BRISA, 'pocion_curacion') });
  const j = jugadorDe(gm.estado(), BRISA);
  assert.equal(j.pg_actual, j.pg_max); // 2d4+2 ≥ 4 > 1 de daño
  assert.equal(j.inventario[0].cantidad, 1);
  assert.match(JSON.stringify(gm.recibidos.at(-1)), /Poción de curación/);
});

test('habilidades: usos que se gastan y vuelven con el descanso', async () => {
  const { gm, torvald } = await mesa();
  await gm.enviar({ tipo: 'otorgar', personaje_id: TORVALD, habilidad: { rasgo_id: 'tomar_aliento' } });
  const inst = jugadorDe(gm.estado(), TORVALD).habilidades[0].instancia;
  await torvald.enviar({ tipo: 'usar_habilidad', instancia: inst });
  assert.equal(jugadorDe(gm.estado(), TORVALD).habilidades[0].usos_restantes, 0);
  await torvald.enviar({ tipo: 'usar_habilidad', instancia: inst });
  assert.equal(torvald.ultimo().tipo, 'error');
  await gm.enviar({ tipo: 'descanso', descanso: 'corto' });
  assert.equal(jugadorDe(gm.estado(), TORVALD).habilidades[0].usos_restantes, 1);
});

test('el inventario sobrevive a reiniciar el servidor', async () => {
  const repo = new RepositorioMemoria(DATOS_DEMO);
  const a = await mesa(repo);
  await a.gm.enviar({ tipo: 'otorgar', personaje_id: TORVALD, item: { item_id: 'escudo' } });
  await a.torvald.enviar({ tipo: 'equipar', instancia: instancia(a.gm.estado(), TORVALD, 'escudo') });
  const b = await mesa(repo); // otro Gestor (servidor nuevo) sobre los mismos datos
  const j = jugadorDe(b.gm.estado(), TORVALD);
  assert.equal(j.inventario[0].item_id, 'escudo');
  assert.equal(j.ca, 20); // 18 de la ficha + escudo
});
