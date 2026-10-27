// Puntos de maná (variante simple en lugar de espacios de conjuro) y resolución de un hechizo.
//
// Variante de la mesa:
//   PM máx. = nivel + modificador de lanzamiento + 2 (mínimo 1), solo para lanzadores.
//   Costo: truco 0, nivel 1 = 2, nivel 2 = 3, nivel 3 = 5.
//   Descanso largo: recupera todo. Descanso corto: la mitad del máximo (hacia arriba), una vez hasta el próximo largo.
import type { Caracteristicas, DatosPersonaje } from '../server/repositorio.ts';
import type { RollResult } from './dice.ts';
import { bonoCompetencia } from './items.ts';
import { modificador } from './habilidades.ts';
import { HECHIZOS, lanzadorDe, type Hechizo } from './hechizos.ts';

export const COSTO_PM: readonly number[] = [0, 2, 3, 5];
export const costoPm = (h: Pick<Hechizo, 'nivel'>) => COSTO_PM[h.nivel] ?? 5;

export interface Magia {
  hechizos: string[]; // ids conocidos/preparados
  pm: number | null; // null: lleno (personaje que aún no gastó)
  pm_corto_usado: boolean;
}

export function leerMagia(datos: DatosPersonaje): Magia {
  const hechizos = Array.isArray(datos.hechizos) ? datos.hechizos.filter((x): x is string => typeof x === 'string' && Object.hasOwn(HECHIZOS, x)) : [];
  return { hechizos, pm: typeof datos.pm === 'number' ? datos.pm : null, pm_corto_usado: datos.pm_corto_usado === true };
}

export const conMagia = (datos: DatosPersonaje, m: Magia): DatosPersonaje =>
  ({ ...datos, hechizos: m.hechizos, pm: m.pm, pm_corto_usado: m.pm_corto_usado });

export function pmMax(clase: string, nivel: number, car: Caracteristicas): number {
  const l = lanzadorDe(clase);
  if (!l || nivel < l.desde_nivel) return 0;
  return Math.max(1, nivel + modificador(car[l.car]) + 2);
}

export const pmActual = (m: Magia, max: number) => Math.min(max, m.pm ?? max);

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Suma o resta PM (el GM), entre 0 y el máximo. */
export function ajustarPm(m: Magia, max: number, cantidad: number): Magia {
  return { ...m, pm: Math.max(0, Math.min(max, pmActual(m, max) + cantidad)) };
}

/** Descanso largo: todo. Corto: la mitad (hacia arriba), una vez entre descansos largos; `corto` lo puede apagar el GM. */
export function descansarPm(m: Magia, max: number, tipo: 'corto' | 'largo', corto = true): { magia: Magia; recuperados: number } {
  const antes = pmActual(m, max);
  if (tipo === 'largo') return { magia: { ...m, pm: max, pm_corto_usado: false }, recuperados: max - antes };
  if (!corto || m.pm_corto_usado) return { magia: m, recuperados: 0 };
  const pm = Math.min(max, antes + Math.ceil(max / 2));
  return { magia: { ...m, pm, pm_corto_usado: true }, recuperados: pm - antes };
}

export interface Lanzamiento {
  hechizo: Hechizo;
  magia: Magia; // con los PM ya descontados
  costo: number;
}

/** Comprueba que el personaje conoce el hechizo y tiene PM; descuenta el costo. */
export function gastarPm(m: Magia, max: number, hechizoId: string): Res<Lanzamiento> {
  const hechizo = HECHIZOS[hechizoId];
  if (!hechizo || !m.hechizos.includes(hechizoId)) return { ok: false, error: `No conoces ${hechizo?.nombre ?? 'ese hechizo'}` };
  const costo = costoPm(hechizo);
  const actual = pmActual(m, max);
  if (actual < costo) return { ok: false, error: `No te alcanza el maná: ${hechizo.nombre} cuesta ${costo} PM y tienes ${actual}` };
  return { ok: true, valor: { hechizo, costo, magia: { ...m, pm: actual - costo } } };
}

export interface Conjurador {
  car: Caracteristicas;
  nivel: number;
  clase: string;
}

/** Bono de ataque de conjuro y CD de salvación. */
export function estadisticasConjuro({ car, nivel, clase }: Conjurador) {
  const l = lanzadorDe(clase);
  const mod = l ? modificador(car[l.car]) : 0;
  const prof = bonoCompetencia(nivel);
  return { mod, ataque: mod + prof, cd: 8 + mod + prof };
}

export interface ResultadoHechizo {
  texto: string; // resumen de las tiradas para el anuncio
  dano: number; // al monstruo objetivo
  curacion: number; // al personaje objetivo
}

/**
 * Tira lo que pida el hechizo. `tirar` es el dado del servidor.
 * `objetivo`: CA del monstruo (ataques). Las salvaciones de los monstruos se tiran con +0 (no guardamos sus características).
 */
export function resolverHechizo(h: Hechizo, l: Conjurador, objetivo: { ca: number } | null, tirar: (n: string) => RollResult): ResultadoHechizo {
  const { mod, ataque, cd } = estadisticasConjuro(l);
  const e = h.efecto;
  const danar = (dano: string) => tirar(dano);
  switch (e.tipo) {
    case 'ataque': {
      const d20 = tirar('1d20');
      const total = d20.total + ataque;
      const impacta = d20.total === 20 || (d20.total !== 1 && (!objetivo || total >= objetivo.ca));
      if (!impacta) return { texto: `ataque ${total} (d20 ${d20.total} ${conSigno(ataque)}): falla`, dano: 0, curacion: 0 };
      const r = danar(e.dano);
      return { texto: `ataque ${total} (d20 ${d20.total} ${conSigno(ataque)}): impacta, ${r.total} de ${e.tipo_dano} (${e.dano})`, dano: r.total, curacion: 0 };
    }
    case 'salvacion': {
      const s = tirar('1d20');
      const salva = s.total >= cd;
      const r = danar(e.dano);
      const dano = salva ? (e.mitad ? Math.floor(r.total / 2) : 0) : r.total;
      return { texto: `salvación de ${e.car.toUpperCase()} ${s.total} contra CD ${cd}: ${salva ? 'salva' : 'falla'}, ${dano} de ${e.tipo_dano} (${e.dano})`, dano, curacion: 0 };
    }
    case 'automatico': {
      const r = danar(e.dano);
      return { texto: `${r.total} de ${e.tipo_dano} (${e.dano}), impacta siempre`, dano: r.total, curacion: 0 };
    }
    case 'curacion': {
      const r = tirar(e.curacion);
      const total = Math.max(0, r.total + mod);
      return { texto: `cura ${total} PG (${e.curacion}${conSigno(mod)})`, dano: 0, curacion: total };
    }
    default:
      return { texto: h.descripcion, dano: 0, curacion: 0 };
  }
}

const conSigno = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
