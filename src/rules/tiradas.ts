// Textos de las tiradas: para qué es cada una y qué salió, siempre explícito.
import type { RollResult } from './dice.ts';

export const MIN_MOTIVO = 8;
const GENERICOS = new Set(['tirada', 'tirar', 'dado', 'dados', 'daño', 'dano', 'ataque', 'chequeo', 'prueba']);

/** Un motivo sirve si dice para qué es: no vacío, no genérico, al menos 8 caracteres. */
export function motivoValido(motivo: string | null | undefined): motivo is string {
  const m = motivo?.trim() ?? '';
  return m.length >= MIN_MOTIVO && !GENERICOS.has(m.toLowerCase());
}

/** Etiqueta de reserva para no bloquear la partida si nadie dijo para qué era. */
export const motivoPorDefecto = (notacion: string) => (/d20/i.test(notacion) ? 'Tirada de d20' : 'Daño');

/** "El GM pide a Brisa: Daño del estoque al kobold (1d8+3)." */
export const textoPeticion = (personaje: string, motivo: string, notacion: string, ia = false) =>
  `${ia ? 'El GM IA' : 'El GM'} pide a ${personaje}: ${motivo} (${notacion}).`;

/** "🎲 Brisa tira 1d8+3 · Daño del estoque al kobold: [2] +3 = 5 — ¡Éxito!" */
export function textoTirada(quien: string, r: RollResult, motivo: string | null, exito: boolean | null) {
  const mod = r.modifier ? ` ${r.modifier > 0 ? '+' : '−'}${Math.abs(r.modifier)}` : '';
  const resultado = exito === true ? ' — ¡Éxito!' : exito === false ? ' — Fracaso' : '';
  return `🎲 ${quien} tira ${r.notation}${motivo ? ` · ${motivo}` : ''}: [${r.kept.join(', ')}]${mod} = ${r.total}${resultado}`;
}
