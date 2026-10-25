import { randomInt } from 'node:crypto';

/** Alfabeto sin caracteres que se confunden: sin 0/O ni 1/I. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LARGO_CODIGO = 6;

export type Aleatorio = (max: number) => number; // entero en [0, max)

/** Código corto de sala, p. ej. "K7MQ2X". */
export function generarCodigo(aleatorio: Aleatorio = randomInt): string {
  return Array.from({ length: LARGO_CODIGO }, () => ALFABETO_CODIGO[aleatorio(ALFABETO_CODIGO.length)]).join('');
}
