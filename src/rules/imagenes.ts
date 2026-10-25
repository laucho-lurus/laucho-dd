// A qué pertenece cada imagen (columna imagenes.pertenece_a) y la lista de imágenes de una campaña.
import type { Diagrama } from './aventura.ts';

export const TIPOS_IMAGEN = ['criatura', 'pnj', 'nodo', 'fondo', 'personaje'] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];

export interface Pertenencia {
  tipo: TipoImagen;
  clave: string; // srd_clave, nombre del PNJ, id del nodo, nombre del fondo o id del personaje
  campana_id?: string; // pnj, nodo y fondo son de una campaña
}

/** "Tobías el Niño" → "tobias-el-nino": nombres saneados para claves. */
export const sanear = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const ID = /^[\w-]{1,64}$/;

/** Valida y arma la clave de pertenece_a: "criatura:goblin", "nodo:<campaña>:<nodo>", "pnj:<campaña>:<nombre>"… */
export function clavePertenencia(p: Partial<Pertenencia> | null | undefined): string | { error: string } {
  if (!p || !(TIPOS_IMAGEN as readonly unknown[]).includes(p.tipo)) return { error: 'Elige a qué pertenece la imagen' };
  if (typeof p.clave !== 'string' || !p.clave.trim()) return { error: 'Falta a quién pertenece la imagen' };
  const tipo = p.tipo as TipoImagen;
  const clave = tipo === 'pnj' || tipo === 'fondo' ? sanear(p.clave) : p.clave.trim();
  if (!ID.test(clave)) return { error: 'Nombre inválido' };
  if (tipo === 'criatura' || tipo === 'personaje') return `${tipo}:${clave}`;
  if (typeof p.campana_id !== 'string' || !ID.test(p.campana_id)) return { error: 'Elige la campaña' };
  return `${tipo}:${p.campana_id}:${clave}`;
}

export interface Pendiente {
  pertenece_a: string;
  tipo: TipoImagen;
  nombre: string;
}

/**
 * Imágenes que necesita una campaña: escenas (nodos que no son decisión ni tirada), PNJ de los
 * diálogos y criaturas (las de la tabla y las que salen en combates).
 */
export function imagenesDeCampana(campanaId: string, diagrama: Diagrama, criaturas: { srd_clave: string; nombre: string }[], pnjs: string[] = []): Pendiente[] {
  const lista: Pendiente[] = [];
  for (const n of diagrama.nodos) {
    if (n.tipo !== 'decision' && n.tipo !== 'tirada') lista.push({ pertenece_a: `nodo:${campanaId}:${n.id}`, tipo: 'nodo', nombre: `Escena: ${n.titulo || n.id}` });
  }
  const nombresPnj = new Set([...pnjs, ...diagrama.nodos.map((n) => n.pnj ?? '').filter(Boolean)]);
  for (const p of nombresPnj) lista.push({ pertenece_a: `pnj:${campanaId}:${sanear(p)}`, tipo: 'pnj', nombre: `PNJ: ${p}` });
  const enCombate = new Set(diagrama.nodos.flatMap((n) => (n.monstruos ?? []).map((m) => m.srd_clave)));
  const vistas = new Set<string>();
  for (const c of criaturas) {
    if (vistas.has(c.srd_clave)) continue;
    vistas.add(c.srd_clave);
    lista.push({ pertenece_a: `criatura:${c.srd_clave}`, tipo: 'criatura', nombre: `Monstruo: ${c.nombre}` });
  }
  for (const clave of enCombate) if (!vistas.has(clave)) lista.push({ pertenece_a: `criatura:${clave}`, tipo: 'criatura', nombre: `Monstruo: ${clave}` });
  return lista;
}
