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

/** Criatura del SRD con un solo ataque. */
const m = (srd_clave: string, nombre: string, ca: number, pg: number, ataque: string, bono: string, dano: string): Plantilla =>
  ({ srd_clave, nombre, ca, pg, ataques: [{ nombre: ataque, ataque: bono, dano }] });

/** SRD 5.1 local: las criaturas que usan las aventuras incluidas (CA y PG del SRD). */
export const SRD_MONSTRUOS: Readonly<Record<string, Plantilla>> = {
  kobold: { srd_clave: 'kobold', nombre: 'Kobold', ca: 12, pg: 5, ataques: [{ nombre: 'Daga', ataque: '+4', dano: '1d4+2 perforante' }] },
  goblin: { srd_clave: 'goblin', nombre: 'Goblin', ca: 15, pg: 7, ataques: [{ nombre: 'Cimitarra', ataque: '+4', dano: '1d6+2 cortante' }] },
  wolf: { srd_clave: 'wolf', nombre: 'Lobo', ca: 13, pg: 11, ataques: [{ nombre: 'Mordisco', ataque: '+4', dano: '2d4+2 perforante' }] },
  bugbear: { srd_clave: 'bugbear', nombre: 'Osgo', ca: 16, pg: 27, ataques: [{ nombre: 'Lucero del alba', ataque: '+4', dano: '2d8+2 perforante' }] },
  // No-muertos
  skeleton: m('skeleton', 'Esqueleto', 13, 13, 'Espada corta', '+4', '1d6+2 perforante'),
  zombie: m('zombie', 'Zombi', 8, 22, 'Golpe', '+3', '1d6+1 contundente'),
  ghoul: m('ghoul', 'Necrófago', 12, 22, 'Garras', '+4', '2d4+2 cortante (CON CD 10 o paralizado)'),
  shadow: m('shadow', 'Sombra', 12, 16, 'Toque que drena', '+4', '2d6+2 necrótico'),
  wight: m('wight', 'Tumulario', 14, 45, 'Espada larga', '+4', '1d8+2 cortante'),
  // Bestias
  giant_rat: m('giant_rat', 'Rata gigante', 12, 7, 'Mordisco', '+4', '1d4+2 perforante'),
  giant_spider: m('giant_spider', 'Araña gigante', 14, 26, 'Mordisco', '+5', '1d8+3 perforante + 2d8 veneno'),
  fire_beetle: m('fire_beetle', 'Escarabajo de fuego', 13, 4, 'Mordisco', '+1', '1d6-1 cortante'),
  giant_crab: m('giant_crab', 'Cangrejo gigante', 15, 13, 'Pinza', '+3', '1d6+1 contundente'),
  reef_shark: m('reef_shark', 'Tiburón de arrecife', 12, 22, 'Mordisco', '+4', '1d8+2 perforante'),
  giant_octopus: m('giant_octopus', 'Pulpo gigante', 11, 52, 'Tentáculos', '+5', '2d6+3 contundente'),
  // Humanoides
  bandit: m('bandit', 'Bandido', 12, 11, 'Cimitarra', '+3', '1d6+1 cortante'),
  bandit_captain: m('bandit_captain', 'Capitán bandido', 15, 65, 'Cimitarra', '+5', '1d6+3 cortante (tres ataques)'),
  thug: m('thug', 'Matón', 11, 32, 'Maza', '+4', '1d6+2 contundente'),
  guard: m('guard', 'Guardia', 16, 11, 'Lanza', '+3', '1d6+1 perforante'),
  cultist: m('cultist', 'Sectario', 12, 9, 'Cimitarra', '+3', '1d6+1 cortante'),
  cult_fanatic: m('cult_fanatic', 'Fanático de secta', 13, 33, 'Daga', '+4', '1d4+2 perforante'),
  spy: m('spy', 'Espía', 12, 27, 'Espada corta', '+4', '1d6+2 perforante'),
  veteran: m('veteran', 'Veterano', 17, 58, 'Espada larga', '+5', '1d8+3 cortante'),
  knight: m('knight', 'Caballero', 18, 52, 'Gran espada', '+5', '2d6+3 cortante'),
  noble: m('noble', 'Noble', 15, 9, 'Estoque', '+3', '1d8+1 perforante'),
  mage: m('mage', 'Mago', 12, 40, 'Daga', '+5', '1d4+2 perforante (lanza conjuros)'),
  orc: m('orc', 'Orco', 13, 15, 'Gran hacha', '+5', '1d12+3 cortante'),
  hobgoblin: m('hobgoblin', 'Hobgoblin', 18, 11, 'Espada larga', '+3', '1d8+1 cortante'),
  duergar: m('duergar', 'Duergar', 16, 26, 'Pico de guerra', '+4', '1d8+2 perforante'),
  sahuagin: m('sahuagin', 'Sahuagin', 12, 22, 'Lanza', '+3', '1d6+1 perforante'),
  // Monstruosidades, elementales y gigantes
  harpy: m('harpy', 'Arpía', 11, 38, 'Garras', '+3', '2d4+1 cortante'),
  sea_hag: m('sea_hag', 'Bruja del mar', 14, 52, 'Garras', '+5', '2d6+3 cortante'),
  merrow: m('merrow', 'Merrow', 13, 45, 'Arpón', '+6', '2d6+4 perforante'),
  magma_mephit: m('magma_mephit', 'Mefit de magma', 11, 22, 'Garras', '+3', '1d4+1 cortante + 2d4 fuego'),
  azer: m('azer', 'Azer', 17, 39, 'Martillo de guerra', '+5', '1d8+3 contundente + 1d6 fuego'),
  ogre: m('ogre', 'Ogro', 11, 59, 'Gran clava', '+6', '2d8+4 contundente'),
  minotaur: m('minotaur', 'Minotauro', 14, 76, 'Gran hacha', '+6', '2d12+4 cortante'),
  will_o_wisp: m('will_o_wisp', 'Fuego fatuo', 19, 22, 'Descarga', '+4', '2d8 relámpago'),
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
