import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustarPm, costoPm, descansarPm, gastarPm, leerMagia, pmMax, resolverHechizo } from './magia.ts';
import { cupos, HECHIZOS, validarEleccion } from './hechizos.ts';
import { nivelPorXp, repartirXp, sumarXp } from './experiencia.ts';
import type { RollResult } from './dice.ts';

const ilyra = { fue: 8, des: 14, con: 12, int: 17, sab: 13, car: 10 }; // Maga: INT +3

test('PM máximo: nivel + modificador + 2, solo para lanzadores', () => {
  assert.equal(pmMax('Mago', 1, ilyra), 6);
  assert.equal(pmMax('Maga', 3, ilyra), 8);
  assert.equal(pmMax('Guerrero', 5, ilyra), 0);
  assert.equal(pmMax('Paladín', 1, ilyra), 0); // lanza desde nivel 2
});

test('costo de maná y gasto: truco gratis, nivel 1 = 2; sin maná o sin conocerlo se rechaza', () => {
  assert.equal(costoPm(HECHIZOS.descarga_de_fuego), 0);
  assert.equal(costoPm(HECHIZOS.proyectil_magico), 2);
  const m = leerMagia({ hechizos: ['proyectil_magico', 'descarga_de_fuego'] });
  const r = gastarPm(m, 6, 'proyectil_magico');
  assert.ok(r.ok && r.valor.magia.pm === 4);
  const vacio = gastarPm({ ...m, pm: 1 }, 6, 'proyectil_magico');
  assert.ok(!vacio.ok && /cuesta 2 PM y tienes 1/.test(vacio.error));
  assert.ok(gastarPm({ ...m, pm: 0 }, 6, 'descarga_de_fuego').ok); // los trucos no cuestan
  const ajeno = gastarPm(m, 6, 'curar_heridas');
  assert.ok(!ajeno.ok && /No conoces Curar heridas/.test(ajeno.error));
});

test('recuperación: largo todo; corto la mitad hacia arriba, una sola vez; el GM puede apagarlo o ajustar', () => {
  const m = { hechizos: [], pm: 0, pm_corto_usado: false };
  const corto = descansarPm(m, 7, 'corto');
  assert.equal(corto.magia.pm, 4);
  assert.equal(descansarPm(corto.magia, 7, 'corto').recuperados, 0);
  assert.equal(descansarPm(m, 7, 'corto', false).recuperados, 0);
  const largo = descansarPm(corto.magia, 7, 'largo');
  assert.deepEqual([largo.magia.pm, largo.magia.pm_corto_usado], [7, false]);
  assert.equal(ajustarPm(m, 7, 99).pm, 7);
});

test('hechizo resuelto: ataque contra CA, salvación con mitad y curación con modificador', () => {
  const dados = (valores: number[]) => (n: string): RollResult => ({ notation: n, total: valores.shift()!, kept: [], rolls: [], modifier: 0 }) as unknown as RollResult;
  const maga = { car: ilyra, nivel: 1, clase: 'Maga' }; // ataque +5, CD 13
  const golpe = resolverHechizo(HECHIZOS.descarga_de_fuego, maga, { ca: 12 }, dados([8, 6]));
  assert.equal(golpe.dano, 6);
  assert.equal(resolverHechizo(HECHIZOS.descarga_de_fuego, maga, { ca: 15 }, dados([8])).dano, 0);
  assert.equal(resolverHechizo(HECHIZOS.manos_ardientes, maga, null, dados([15, 11])).dano, 5); // salva: mitad
  const clerigo = { car: { ...ilyra, sab: 16 }, nivel: 1, clase: 'Clérigo' };
  assert.equal(resolverHechizo(HECHIZOS.curar_heridas, clerigo, null, dados([5])).curacion, 8);
});

test('elección de hechizos en la creación: cantidades del SRD y solo de la clase', () => {
  assert.deepEqual(cupos('Mago', ilyra), { trucos: 3, nivel1: 6 });
  assert.deepEqual(cupos('Clérigo', { ...ilyra, sab: 16 }), { trucos: 3, nivel1: 4 }); // SAB +3 + nivel 1
  assert.deepEqual(cupos('Guerrero', ilyra), { trucos: 0, nivel1: 0 });
  const ok = validarEleccion('Brujo', ilyra, ['descarga_sobrenatural', 'toque_helado', 'brazos_de_hadar', 'represion_infernal']);
  assert.ok(ok.ok);
  const mal = validarEleccion('Brujo', ilyra, ['descarga_sobrenatural', 'curar_heridas']);
  assert.ok(!mal.ok && /no es un hechizo de tu clase/.test(mal.error));
  const pocos = validarEleccion('Brujo', ilyra, ['descarga_sobrenatural']);
  assert.ok(!pocos.ok && /2 trucos y 2 hechizos/.test(pocos.error));
});

test('XP: niveles por tabla SRD, subida con PG y competencia, reparto del combate', () => {
  assert.deepEqual([nivelPorXp(0), nivelPorXp(299), nivelPorXp(300), nivelPorXp(2700), nivelPorXp(999999)], [1, 1, 2, 4, 20]);
  const s = sumarXp('Guerrero', { ...ilyra, con: 16 }, 1, 250, 700); // 950 XP: nivel 3
  assert.deepEqual(s, { xp: 950, nivel: 3, pg_extra: 18, competencia: 2 }); // 2 × (5 + 1 + 3)
  assert.equal(sumarXp('Mago', ilyra, 3, 950, -900).nivel, 3); // quitar XP no baja de nivel
  assert.equal(repartirXp(['kobold', 'kobold', 'goblin'], 2), 50);
});
