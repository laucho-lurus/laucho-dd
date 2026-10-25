// Mapa táctico de cuadrícula: posiciones de fichas, velocidad y niebla de guerra.
// 1 casilla = 5 pies; las diagonales cuentan como 1 casilla (regla simple de 5e).

export interface Posicion {
  x: number;
  y: number;
}

export interface Mapa {
  ancho: number;
  alto: number;
  velocidad: number; // casillas por movimiento de un jugador
  fondo_url: string | null;
  fichas: Record<string, Posicion>; // personaje_id o id de monstruo → casilla
  ocultas: number[]; // índices de casilla (y * ancho + x) bajo niebla
}

export const PIES_POR_CASILLA = 5;
export const VELOCIDAD_POR_DEFECTO = 6;
export const LIMITES = { min: 5, max: 60, velocidadMax: 30 };

export function crearMapa(ancho: number, alto: number, velocidad = VELOCIDAD_POR_DEFECTO, base?: Mapa | null): Mapa | string {
  const entero = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!entero(ancho, LIMITES.min, LIMITES.max) || !entero(alto, LIMITES.min, LIMITES.max)) return `El mapa va de ${LIMITES.min} a ${LIMITES.max} casillas por lado`;
  if (!entero(velocidad, 1, LIMITES.velocidadMax)) return `La velocidad va de 1 a ${LIMITES.velocidadMax} casillas`;
  // Al redimensionar se conservan las fichas y la niebla que sigan dentro.
  const dentro = (p: Posicion) => p.x < ancho && p.y < alto;
  const fichas = Object.fromEntries(Object.entries(base?.fichas ?? {}).filter(([, p]) => dentro(p)));
  const ocultas = (base?.ocultas ?? [])
    .map((i) => ({ x: i % base!.ancho, y: Math.floor(i / base!.ancho) }))
    .filter(dentro)
    .map((p) => p.y * ancho + p.x);
  return { ancho, alto, velocidad, fondo_url: base?.fondo_url ?? null, fichas, ocultas };
}

export const distancia = (a: Posicion, b: Posicion) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const indice = (m: Mapa, p: Posicion) => p.y * m.ancho + p.x;
export const estaOculta = (m: Mapa, p: Posicion) => m.ocultas.includes(indice(m, p));

/** ¿Puede `id` ir a `destino`? El GM mueve sin límite de velocidad. Devuelve el motivo si no. */
export function validarMovimiento(m: Mapa, id: string, destino: Posicion, esGm: boolean): string | null {
  if (!Number.isInteger(destino.x) || !Number.isInteger(destino.y) || destino.x < 0 || destino.y < 0 || destino.x >= m.ancho || destino.y >= m.alto) {
    return 'Esa casilla está fuera del mapa';
  }
  const ocupante = Object.entries(m.fichas).find(([otro, p]) => otro !== id && p.x === destino.x && p.y === destino.y);
  if (ocupante) return 'Esa casilla está ocupada';
  const origen = m.fichas[id];
  if (!esGm && origen) {
    const d = distancia(origen, destino);
    if (d > m.velocidad) return `Demasiado lejos: ${d} casillas (${d * PIES_POR_CASILLA} pies); tu velocidad es ${m.velocidad} (${m.velocidad * PIES_POR_CASILLA} pies)`;
  }
  return null;
}

export const moverFicha = (m: Mapa, id: string, destino: Posicion): Mapa => ({ ...m, fichas: { ...m.fichas, [id]: { x: destino.x, y: destino.y } } });

export const quitarFicha = (m: Mapa, id: string): Mapa => ({ ...m, fichas: Object.fromEntries(Object.entries(m.fichas).filter(([k]) => k !== id)) });

/** Oculta o revela casillas (las que estén dentro del mapa). */
export function cambiarNiebla(m: Mapa, celdas: Posicion[], oculta: boolean): Mapa {
  const indices = celdas.filter((p) => p.x >= 0 && p.y >= 0 && p.x < m.ancho && p.y < m.alto).map((p) => indice(m, p));
  const actual = new Set(m.ocultas);
  for (const i of indices) {
    if (oculta) actual.add(i);
    else actual.delete(i);
  }
  return { ...m, ocultas: [...actual].sort((a, b) => a - b) };
}

/** Lo que ven los jugadores: sin las fichas de monstruos que estén bajo la niebla. */
export function vistaJugadores(m: Mapa, esMonstruo: (id: string) => boolean): Mapa {
  return { ...m, fichas: Object.fromEntries(Object.entries(m.fichas).filter(([id, p]) => !(esMonstruo(id) && estaOculta(m, p)))) };
}
