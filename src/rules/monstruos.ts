// Monstruos de un encuentro: PG y CA llevados por el servidor; los jugadores solo ven su estado.

export interface AtaqueMonstruo {
  nombre: string;
  ataque: string; // "+4"
  dano: string; // "1d6+2 cortante"
}

/** Ficha base de una criatura (de la tabla criaturas o del SRD local). */
export interface Plantilla {
  srd_clave: string;
  nombre: string;
  ca: number;
  pg: number;
  ataques: AtaqueMonstruo[];
}

export interface Monstruo {
  id: string; // "m1", "m2"…
  nombre: string; // "Kobold 2"
  srd_clave: string;
  ca: number;
  pg_max: number;
  pg_actual: number;
  ataques: AtaqueMonstruo[];
  imagen_url?: string | null;
}

export type EstadoMonstruo = 'sano' | 'herido' | 'malherido' | 'caído';

export const MAX_MONSTRUOS_VIVOS = 6;

/** SRD 5.1 local, solo las criaturas que usa la aventura y que no estén en la tabla criaturas. */
export const SRD_MONSTRUOS: Readonly<Record<string, Plantilla>> = {
  kobold: { srd_clave: 'kobold', nombre: 'Kobold', ca: 12, pg: 5, ataques: [{ nombre: 'Daga', ataque: '+4', dano: '1d4+2 perforante' }] },
  goblin: { srd_clave: 'goblin', nombre: 'Goblin', ca: 15, pg: 7, ataques: [{ nombre: 'Cimitarra', ataque: '+4', dano: '1d6+2 cortante' }] },
  wolf: { srd_clave: 'wolf', nombre: 'Lobo', ca: 13, pg: 11, ataques: [{ nombre: 'Mordisco', ataque: '+4', dano: '2d4+2 perforante' }] },
  bugbear: { srd_clave: 'bugbear', nombre: 'Osgo', ca: 16, pg: 27, ataques: [{ nombre: 'Lucero del alba', ataque: '+4', dano: '2d8+2 perforante' }] },
};

export function estadoMonstruo(m: Pick<Monstruo, 'pg_actual' | 'pg_max'>): EstadoMonstruo {
  if (m.pg_actual <= 0) return 'caído';
  if (m.pg_actual >= m.pg_max) return 'sano';
  return m.pg_actual > m.pg_max / 2 ? 'herido' : 'malherido';
}

/** Lo que ven los jugadores: nombre y estado, sin cifras. */
export const monstruoPublico = (m: Monstruo) => ({ id: m.id, nombre: m.nombre, estado: estadoMonstruo(m), imagen_url: m.imagen_url ?? null });

/** Las criaturas de la campaña primero; del SRD local, solo las que falten. */
export function unirCriaturas(propias: Plantilla[]): Plantilla[] {
  const claves = new Set(propias.map((c) => c.srd_clave));
  return [...propias, ...Object.values(SRD_MONSTRUOS).filter((c) => !claves.has(c.srd_clave))];
}

/** Plantilla desde una fila de la tabla criaturas (stats jsonb: ca, pg, ataques). */
export function plantillaDeCriatura(c: { nombre: string; srd_clave: string | null; stats: Record<string, unknown> }): Plantilla | null {
  const { ca, pg, ataques } = c.stats as { ca?: unknown; pg?: unknown; ataques?: unknown };
  if (!c.srd_clave || typeof ca !== 'number' || typeof pg !== 'number') return null;
  return { srd_clave: c.srd_clave, nombre: c.nombre, ca, pg, ataques: Array.isArray(ataques) ? (ataques as AtaqueMonstruo[]) : [] };
}
