export type Rng = () => number; // devuelve un número en [0, 1)

export interface RollResult {
  notation: string;
  rolls: number[]; // todas las tiradas hechas
  kept: number[]; // las que cuentan
  modifier: number;
  total: number;
}

const NOTATION = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/i;

const d = (sides: number, rng: Rng) => Math.floor(rng() * sides) + 1;

/** Tira notación estándar: "1d20+5", "2d6+3", "4d6kh3" (quedarse con las 3 mejores). */
export function roll(notation: string, rng: Rng = Math.random): RollResult {
  const m = NOTATION.exec(notation.replace(/\s/g, ''));
  if (!m) throw new Error(`Notación de dados inválida: "${notation}"`);
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count < 1 || count > 100 || sides < 2) throw new Error(`Dados fuera de rango: "${notation}"`);

  const rolls = Array.from({ length: count }, () => d(sides, rng));
  let kept = rolls;
  if (m[3]) {
    const n = Number(m[4]);
    const sorted = [...rolls].sort((a, b) => a - b);
    kept = m[3].toLowerCase() === 'kh' ? sorted.slice(-n) : sorted.slice(0, n);
  }
  const modifier = m[5] ? Number(m[5]) : 0;
  return { notation, rolls, kept, modifier, total: kept.reduce((a, b) => a + b, 0) + modifier };
}

export type D20Mode = 'normal' | 'ventaja' | 'desventaja';

export interface D20Result {
  rolls: number[];
  natural: number; // el d20 que cuenta
  modifier: number;
  total: number;
  critico: boolean; // 20 natural
  pifia: boolean; // 1 natural
}

/** Tirada de d20 con ventaja o desventaja. */
export function d20(modifier = 0, mode: D20Mode = 'normal', rng: Rng = Math.random): D20Result {
  const rolls = mode === 'normal' ? [d(20, rng)] : [d(20, rng), d(20, rng)];
  const natural = mode === 'ventaja' ? Math.max(...rolls) : mode === 'desventaja' ? Math.min(...rolls) : rolls[0];
  return { rolls, natural, modifier, total: natural + modifier, critico: natural === 20, pifia: natural === 1 };
}

/** Modificador de característica: (valor - 10) / 2 redondeado hacia abajo. */
export const modificador = (valor: number) => Math.floor((valor - 10) / 2);

/** Característica aleatoria: 4d6 quitando el menor. */
export const caracteristicaAleatoria = (rng: Rng = Math.random) => roll('4d6kh3', rng).total;

/** Seis características aleatorias, en orden FUE DES CON INT SAB CAR. */
export const caracteristicasAleatorias = (rng: Rng = Math.random) =>
  Array.from({ length: 6 }, () => caracteristicaAleatoria(rng));
