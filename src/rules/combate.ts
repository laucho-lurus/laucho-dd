// Combate del lado del servidor: ataques de monstruos, críticos, pifias y salvaciones de muerte (SRD 5.1, simplificado).
import type { RollResult } from './dice.ts';
import type { AtaqueMonstruo } from './monstruos.ts';
import { distancia, type Posicion } from './mapa.ts';

export type Tirar = (notacion: string) => RollResult;

const DADOS = /(\d+)d(\d+)\s*([+-]\s*\d+)?\s*([a-záéíóúñ]+)?/gi;

/** "1d8+3 perforante + 2d8 veneno" → [{1d8+3, perforante}, {2d8, veneno}]. */
export function partesDeDano(texto: string): { dados: string; tipo: string }[] {
  return [...texto.matchAll(DADOS)].map((m) => ({ dados: `${m[1]}d${m[2]}${m[3] ? m[3].replace(/\s/g, '') : ''}`, tipo: m[4] ?? '' }));
}

/** Crítico: el doble de dados, el mismo modificador ("1d8+3" → "2d8+3"). */
export const duplicarDados = (dados: string) => dados.replace(/^(\d+)d/, (_, n) => `${Number(n) * 2}d`);

/** "(dos ataques)" / "(tres ataques)" en el daño o el nombre: multiataque. */
export function ataquesPorTurno(a: AtaqueMonstruo): number {
  const t = `${a.nombre} ${a.dano}`.toLowerCase();
  if (/tres ataques/.test(t)) return 3;
  if (/dos ataques/.test(t)) return 2;
  return 1;
}

/** Armas y ataques a distancia: no necesitan acercarse. */
export const esADistancia = (a: AtaqueMonstruo) => /arco|ballesta|honda|jabalina|arpón|descarga|rayo/i.test(a.nombre);

export interface ResultadoAtaque {
  d20: number;
  total: number;
  impacta: boolean;
  critico: boolean;
  dano: number;
  texto: string; // "14 vs CA 18, falla" / "¡crítico! impacta, 9 de daño"
}

/** Un ataque: d20 + bono contra la CA; 20 natural siempre impacta (crítico, doble de dados), 1 natural siempre falla. */
export function resolverAtaque(a: AtaqueMonstruo, ca: number, tirar: Tirar): ResultadoAtaque {
  const bono = Number.parseInt(a.ataque, 10) || 0;
  const d20 = tirar('1d20').total;
  const total = d20 + bono;
  const critico = d20 === 20;
  const impacta = critico || (d20 !== 1 && total >= ca);
  const base = `${total} vs CA ${ca}`;
  if (!impacta) return { d20, total, impacta, critico, dano: 0, texto: `${base}, ${d20 === 1 ? '1 natural, ' : ''}falla` };
  const partes = partesDeDano(a.dano);
  const dano = Math.max(1, partes.reduce((s, p) => s + tirar(critico ? duplicarDados(p.dados) : p.dados).total, 0));
  const tipos = partes.map((p) => p.tipo).filter(Boolean).join(' y ');
  return { d20, total, impacta, critico, dano, texto: `${base}, ${critico ? '¡crítico! ' : ''}impacta, ${dano} de daño${tipos ? ` ${tipos}` : ''}` };
}

// --- Salvaciones de muerte

export interface Muerte {
  exitos: number;
  fallos: number;
  estable: boolean;
  muerto: boolean;
}

export const MUERTE_INICIAL: Muerte = { exitos: 0, fallos: 0, estable: false, muerto: false };

const cerrar = (m: Muerte): Muerte => ({ ...m, estable: m.estable || m.exitos >= 3, muerto: m.fallos >= 3 });

/** d20 al inicio de su turno: 10+ éxito, 20 natural vuelve con 1 PG, 1 natural son dos fallos. */
export function salvacionDeMuerte(m: Muerte, d20: number): { muerte: Muerte; despierta: boolean; texto: string } {
  if (d20 === 20) return { muerte: MUERTE_INICIAL, despierta: true, texto: '20 natural: ¡recupera 1 PG y se levanta!' };
  const siguiente = cerrar(d20 === 1 ? { ...m, fallos: m.fallos + 2 } : d20 >= 10 ? { ...m, exitos: m.exitos + 1 } : { ...m, fallos: m.fallos + 1 });
  const estado = siguiente.muerto ? ' Ha muerto.' : siguiente.estable ? ' Queda estable.' : '';
  const tipo = d20 === 1 ? '1 natural: dos fallos' : d20 >= 10 ? 'éxito' : 'fallo';
  return { muerte: siguiente, despierta: false, texto: `salvación de muerte ${d20} (${tipo}): ${siguiente.exitos} éxitos, ${siguiente.fallos} fallos.${estado}` };
}

/** Recibir daño estando a 0 PG: un fallo (dos si es crítico); deja de estar estable. */
export const danoACaido = (m: Muerte, critico: boolean): Muerte =>
  cerrar({ ...m, estable: false, exitos: m.estable ? 0 : m.exitos, fallos: m.fallos + (critico ? 2 : 1) });

// --- Pifias (1 natural en un ataque de jugador)

export type Pifia = 'se_hiere' | 'hiere_aliado' | 'pierde_turno' | 'desventaja';

export const PIFIAS: readonly { tipo: Pifia; texto: string }[] = [
  { tipo: 'se_hiere', texto: 'se golpea a sí mismo' },
  { tipo: 'hiere_aliado', texto: 'golpea por accidente a un aliado cercano' },
  { tipo: 'pierde_turno', texto: 'se le resbala el arma y pierde su próximo turno recogiéndola' },
  { tipo: 'desventaja', texto: 'queda desequilibrado: desventaja en su próxima tirada' },
];

/** 1d4 en la tabla de pifias. */
export const tirarPifia = (tirar: Tirar) => PIFIAS[tirar('1d4').total - 1] ?? PIFIAS[3];

/** Desventaja: "1d20+5" → "2d20kl1+5". Otras notaciones no cambian. */
export const conDesventaja = (notacion: string) => notacion.replace(/^1?d20(?![kd\d])/i, '2d20kl1');

// --- Objetivo y movimiento

/**
 * Objetivo del monstruo: el sugerido (GM o IA) si sigue en pie; si no, el personaje consciente más cercano
 * en el mapa; sin mapa, uno al azar. `azar` en [0, 1).
 */
export function elegirObjetivo(
  candidatos: { id: string; pos?: Posicion }[], desde: Posicion | undefined, sugerido: string | undefined, azar: number,
): string | null {
  if (!candidatos.length) return null;
  if (sugerido && candidatos.some((c) => c.id === sugerido)) return sugerido;
  const ubicados = desde ? candidatos.filter((c) => c.pos) : [];
  if (ubicados.length) return ubicados.reduce((a, b) => (distancia(desde!, b.pos!) < distancia(desde!, a.pos!) ? b : a)).id;
  return candidatos[Math.min(candidatos.length - 1, Math.floor(azar * candidatos.length))].id;
}

/** Hasta `pasos` casillas hacia `meta`, parando al lado. `libre` dice si se puede pisar una casilla. */
export function acercarse(desde: Posicion, meta: Posicion, pasos: number, libre: (p: Posicion) => boolean): Posicion {
  let p = desde;
  for (let i = 0; i < pasos && distancia(p, meta) > 1; i++) {
    const siguiente = { x: p.x + Math.sign(meta.x - p.x), y: p.y + Math.sign(meta.y - p.y) };
    if (!libre(siguiente)) break;
    p = siguiente;
  }
  return p;
}
