// Creación de personajes de nivel 1 (SRD 5.1, versión simplificada).
import type { Arma, Caracteristicas } from '../server/repositorio.ts';
import { modificador } from './habilidades.ts';

export type Car = keyof Caracteristicas;
export const CARACTERISTICAS: readonly Car[] = ['fue', 'des', 'con', 'int', 'sab', 'car'];

export interface Raza {
  nombre: string;
  bonos: Partial<Caracteristicas>;
}

// Semielfo: el SRD da +1 a otras dos a elección; en esta versión solo aplicamos el +2 a CAR.
export const RAZAS: Readonly<Record<string, Raza>> = {
  humano: { nombre: 'Humano', bonos: { fue: 1, des: 1, con: 1, int: 1, sab: 1, car: 1 } },
  elfo: { nombre: 'Elfo', bonos: { des: 2 } },
  enano: { nombre: 'Enano', bonos: { con: 2 } },
  mediano: { nombre: 'Mediano', bonos: { des: 2 } },
  draconato: { nombre: 'Draconato', bonos: { fue: 2, car: 1 } },
  gnomo: { nombre: 'Gnomo', bonos: { int: 2 } },
  semielfo: { nombre: 'Semielfo', bonos: { car: 2 } },
  semiorco: { nombre: 'Semiorco', bonos: { fue: 2, con: 1 } },
  tiefling: { nombre: 'Tiefling', bonos: { car: 2, int: 1 } },
};

export interface Clase {
  nombre: string;
  dado_golpe: number;
  salvaciones: Car[];
  armas: ArmaBase[];
}

/** Arma inicial: el bonificador de ataque se calcula con la característica `car`. */
export interface ArmaBase {
  nombre: string;
  car: Car;
  dano: string;
}

const arma = (nombre: string, car: Car, dano: string): ArmaBase => ({ nombre, car, dano });

export const CLASES: Readonly<Record<string, Clase>> = {
  barbaro: { nombre: 'Bárbaro', dado_golpe: 12, salvaciones: ['fue', 'con'], armas: [arma('Gran hacha', 'fue', '1d12'), arma('Jabalina', 'fue', '1d6')] },
  bardo: { nombre: 'Bardo', dado_golpe: 8, salvaciones: ['des', 'car'], armas: [arma('Estoque', 'des', '1d8'), arma('Daga', 'des', '1d4')] },
  clerigo: { nombre: 'Clérigo', dado_golpe: 8, salvaciones: ['sab', 'car'], armas: [arma('Maza', 'fue', '1d6')] },
  druida: { nombre: 'Druida', dado_golpe: 8, salvaciones: ['int', 'sab'], armas: [arma('Cimitarra', 'des', '1d6')] },
  guerrero: { nombre: 'Guerrero', dado_golpe: 10, salvaciones: ['fue', 'con'], armas: [arma('Espada larga', 'fue', '1d8'), arma('Arco largo', 'des', '1d8')] },
  monje: { nombre: 'Monje', dado_golpe: 8, salvaciones: ['fue', 'des'], armas: [arma('Espada corta', 'des', '1d6'), arma('Golpe sin armas', 'des', '1d4')] },
  paladin: { nombre: 'Paladín', dado_golpe: 10, salvaciones: ['sab', 'car'], armas: [arma('Espada larga', 'fue', '1d8'), arma('Jabalina', 'fue', '1d6')] },
  explorador: { nombre: 'Explorador', dado_golpe: 10, salvaciones: ['fue', 'des'], armas: [arma('Arco largo', 'des', '1d8'), arma('Espada corta', 'des', '1d6')] },
  picaro: { nombre: 'Pícaro', dado_golpe: 8, salvaciones: ['des', 'int'], armas: [arma('Estoque', 'des', '1d8'), arma('Arco corto', 'des', '1d6')] },
  hechicero: { nombre: 'Hechicero', dado_golpe: 6, salvaciones: ['con', 'car'], armas: [arma('Daga', 'des', '1d4')] },
  brujo: { nombre: 'Brujo', dado_golpe: 8, salvaciones: ['sab', 'car'], armas: [arma('Daga', 'des', '1d4')] },
  mago: { nombre: 'Mago', dado_golpe: 6, salvaciones: ['int', 'sab'], armas: [arma('Bastón', 'fue', '1d6')] },
};

export const ALINEAMIENTOS = [
  'Legal bueno', 'Neutral bueno', 'Caótico bueno',
  'Legal neutral', 'Neutral', 'Caótico neutral',
  'Legal malvado', 'Neutral malvado', 'Caótico malvado',
] as const;

export type Metodo = 'aleatorio' | 'estandar' | 'compra' | 'custom';
export const METODOS: readonly Metodo[] = ['aleatorio', 'estandar', 'compra', 'custom'];

export const ARREGLO_ESTANDAR = [15, 14, 13, 12, 10, 8] as const;
export const PUNTOS_COMPRA = 27;
const COSTE_COMPRA: Readonly<Record<number, number>> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const BONO_COMPETENCIA_N1 = 2;

const mismosValores = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

/**
 * Valida las características base (antes de bonos raciales) según el método.
 * `tiradas`: para "aleatorio", los 6 valores que tiró el servidor.
 */
export function validarCaracteristicas(metodo: Metodo, base: Caracteristicas, tiradas?: readonly number[]): string | null {
  const valores = CARACTERISTICAS.map((c) => base[c]);
  if (!valores.every(Number.isInteger)) return 'Las características deben ser números enteros';
  switch (metodo) {
    case 'estandar':
      return mismosValores(valores, ARREGLO_ESTANDAR) ? null : 'Usa cada valor del arreglo estándar (15, 14, 13, 12, 10, 8) una vez';
    case 'compra': {
      if (valores.some((v) => !(v in COSTE_COMPRA))) return 'En compra de puntos cada característica va de 8 a 15';
      const gasto = valores.reduce((s, v) => s + COSTE_COMPRA[v], 0);
      return gasto <= PUNTOS_COMPRA ? null : `Gastaste ${gasto} puntos; el máximo es ${PUNTOS_COMPRA}`;
    }
    case 'custom':
      return valores.every((v) => v >= 3 && v <= 20) ? null : 'Cada característica va de 3 a 20';
    case 'aleatorio':
      if (!tiradas) return 'Primero tira las características';
      return mismosValores(valores, tiradas) ? null : 'Asigna exactamente los valores que tiraste';
  }
}

export function aplicarBonos(base: Caracteristicas, raza: Raza): Caracteristicas {
  const final = { ...base };
  for (const c of CARACTERISTICAS) final[c] = Math.min(20, base[c] + (raza.bonos[c] ?? 0));
  return final;
}

const conSigno = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** PG máximo, CA y armas de un personaje de nivel 1. */
export function derivados(car: Caracteristicas, clase: Clase) {
  return {
    pg_max: Math.max(1, clase.dado_golpe + modificador(car.con)),
    ca: 10 + modificador(car.des),
    salvaciones: clase.salvaciones,
    armas: clase.armas.map((a): Arma => {
      const mod = modificador(car[a.car]);
      const { nombre, dano } = a;
      return { nombre, ataque: conSigno(mod + BONO_COMPETENCIA_N1), dano: mod ? `${dano}${conSigno(mod)}` : dano };
    }),
  };
}
