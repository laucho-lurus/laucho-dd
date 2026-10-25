// Formato de una aventura para cargar con `npm run seed -- <id>` y ayudas para escribirla.
import type { Diagrama, Flecha, Nodo, Variables } from '../../src/rules/aventura.ts';

export interface SemillaCampana {
  id: string; // para elegirla en la línea de comandos
  nombre: string;
  resumen: string;
  variables: Variables;
  diagrama: Diagrama;
  /** Criaturas propias de la campaña (tabla criaturas). Las del SRD local no hace falta repetirlas. */
  criaturas?: { nombre: string; srd_clave: string; stats: Record<string, unknown> }[];
}

type Extra = Partial<Omit<Nodo, 'id' | 'tipo' | 'titulo' | 'texto' | 'notas'>>;
const nodo = (tipo: string) => (id: string, titulo: string, texto: string, notas: string, extra: Extra = {}): Nodo =>
  ({ id, tipo, titulo, texto, notas, ...extra });

export const escena = nodo('escena');
export const evento = nodo('evento');
export const decision = (id: string, titulo: string, texto: string, notas: string, opciones: string[]) => nodo('decision')(id, titulo, texto, notas, { opciones });
export const tirada = (id: string, titulo: string, texto: string, notas: string, chequeo: string, cd: number) => nodo('tirada')(id, titulo, texto, notas, { chequeo, cd });
export const combate = (id: string, titulo: string, texto: string, notas: string, monstruos: [string, number][]) =>
  nodo('combate')(id, titulo, texto, notas, { monstruos: monstruos.map(([srd_clave, cantidad]) => ({ srd_clave, cantidad })) });
export const dialogo = (id: string, titulo: string, texto: string, notas: string, pnj: string, sabe: string, quiere: string) =>
  nodo('dialogo')(id, titulo, texto, notas, { pnj, sabe, quiere });
export const final = (id: string, titulo: string, texto: string, notas: string, recompensas: string, xp: number) =>
  nodo('final')(id, titulo, texto, notas, { recompensas, xp });

/** f('1', '2', 'Continuar', { si: 'llave = true', fija: { llave: true } }) */
export function f(desde: string, hasta: string, etiqueta: string, o: { si?: string; fija?: Variables } = {}): Flecha {
  return {
    desde, hasta, etiqueta,
    ...(o.si && { condicion: o.si }),
    ...(o.fija && { efectos: Object.entries(o.fija).map(([variable, valor]) => ({ variable, valor })) }),
  };
}
