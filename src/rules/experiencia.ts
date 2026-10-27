// Experiencia y niveles (SRD 5.1): tabla de XP, subida de nivel y XP por monstruo derrotado.
import type { Caracteristicas } from '../server/repositorio.ts';
import { modificador } from './habilidades.ts';
import { bonoCompetencia } from './items.ts';
import { claseBase } from './rasgos.ts';
import { CLASES } from './personaje.ts';

/** XP total necesaria para cada nivel (índice 0 = nivel 1). */
export const TABLA_XP: readonly number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];
export const NIVEL_MAX = TABLA_XP.length;

export function nivelPorXp(xp: number): number {
  let nivel = 1;
  while (nivel < NIVEL_MAX && xp >= TABLA_XP[nivel]) nivel += 1;
  return nivel;
}

/** XP que falta para el próximo nivel (null en el 20). */
export const xpSiguiente = (nivel: number): number | null => (nivel < NIVEL_MAX ? TABLA_XP[nivel] : null);

const dadoDeGolpe = (clase: string) => Object.values(CLASES).find((c) => c.nombre === claseBase(clase))?.dado_golpe ?? 8;

/** PG que gana al subir de `desde` a `hasta` (promedio fijo del SRD: dado/2 + 1 + mod CON, mínimo 1 por nivel). */
export function pgPorNiveles(clase: string, car: Caracteristicas, desde: number, hasta: number): number {
  const porNivel = Math.max(1, dadoDeGolpe(clase) / 2 + 1 + modificador(car.con));
  return Math.max(0, hasta - desde) * porNivel;
}

export interface Subida {
  xp: number;
  nivel: number;
  pg_extra: number;
  competencia: number;
}

/** Suma XP (nunca baja de 0) y calcula si sube de nivel. No baja de nivel si se quita XP. */
export function sumarXp(clase: string, car: Caracteristicas, nivel: number, xp: number, cantidad: number): Subida {
  const total = Math.max(0, xp + cantidad);
  const nuevo = Math.max(nivel, nivelPorXp(total));
  return { xp: total, nivel: nuevo, pg_extra: pgPorNiveles(clase, car, nivel, nuevo), competencia: bonoCompetencia(nuevo) };
}

/** XP de las criaturas del SRD local según su valor de desafío. */
export const XP_MONSTRUO: Readonly<Record<string, number>> = {
  kobold: 25, goblin: 50, wolf: 50, bugbear: 200,
  skeleton: 50, zombie: 50, ghoul: 200, shadow: 100, wight: 700,
  giant_rat: 25, giant_spider: 200, fire_beetle: 10, giant_crab: 25, reef_shark: 100, giant_octopus: 200,
  bandit: 25, bandit_captain: 450, thug: 100, guard: 25, cultist: 25, cult_fanatic: 450, spy: 200, veteran: 700,
  knight: 700, noble: 25, mage: 2300, orc: 100, hobgoblin: 100, duergar: 200, sahuagin: 100,
  harpy: 200, sea_hag: 450, merrow: 450, magma_mephit: 100, azer: 450, ogre: 450, minotaur: 700, will_o_wisp: 450,
};

export const xpDeMonstruo = (srdClave: string) => XP_MONSTRUO[srdClave] ?? 10;

/** Reparte la XP del combate a partes iguales (hacia abajo) entre los personajes de la mesa. */
export function repartirXp(srdClaves: string[], personajes: number): number {
  if (personajes <= 0) return 0;
  return Math.floor(srdClaves.reduce((s, k) => s + xpDeMonstruo(k), 0) / personajes);
}
