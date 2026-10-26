// Inventario y habilidades de un personaje (dentro de personajes.datos). Funciones puras: devuelven copias.
import { CATALOGO, type Equipo, type ItemInventario } from './items.ts';
import { RASGOS, type ObjetivoModificador, type Recarga, type UsoHabilidad } from './rasgos.ts';
import type { Caracteristicas, DatosPersonaje } from '../server/repositorio.ts';

export const MAX_CANTIDAD = 99;

export interface HabilidadPj {
  instancia: string;
  rasgo_id: string; // del catálogo o "custom"
  nombre: string;
  descripcion: string;
  uso: UsoHabilidad;
  recarga?: Recarga;
  usos_max: number; // 0 = sin límite
  usos_restantes: number;
  modificador?: { a: ObjetivoModificador; valor: number };
}

export interface Inventario {
  inventario: ItemInventario[];
  habilidades: HabilidadPj[];
  equipo: Equipo;
}

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };
const falla = <T>(error: string): Res<T> => ({ ok: false, error });

export function leerInventario(datos: DatosPersonaje): Inventario {
  return {
    inventario: Array.isArray(datos.inventario) ? (datos.inventario as ItemInventario[]) : [],
    habilidades: Array.isArray(datos.habilidades) ? (datos.habilidades as HabilidadPj[]) : [],
    equipo: (datos.equipo as Equipo | undefined) ?? {},
  };
}

export const conInventario = (datos: DatosPersonaje, inv: Inventario): DatosPersonaje => ({ ...datos, ...inv });

const apilable = (tipo: string) => tipo === 'pocion' || tipo === 'objeto';

export type PedidoItem = { item_id: string; cantidad?: number } | { custom: { nombre: string; descripcion?: string }; cantidad?: number };

/** Añade un objeto (del catálogo o inventado). Pociones y objetos del mismo tipo se apilan. */
export function otorgarItem(inv: Inventario, pedido: PedidoItem, nuevaInstancia: () => string): Res<{ inv: Inventario; item: ItemInventario }> {
  const cantidad = pedido.cantidad ?? 1;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) return falla(`La cantidad va de 1 a ${MAX_CANTIDAD}`);
  let base: Omit<ItemInventario, 'instancia' | 'cantidad'>;
  if ('item_id' in pedido) {
    const c = CATALOGO[pedido.item_id];
    if (!c) return falla('Ese objeto no está en el catálogo');
    base = { item_id: c.id, nombre: c.nombre, tipo: c.tipo, descripcion: c.descripcion };
  } else {
    const nombre = pedido.custom.nombre?.trim().slice(0, 60);
    if (!nombre) return falla('El objeto necesita un nombre');
    base = { item_id: 'custom', nombre, tipo: 'objeto', descripcion: (pedido.custom.descripcion ?? '').trim().slice(0, 300) };
  }
  const igual = apilable(base.tipo) && inv.inventario.find((i) => i.item_id === base.item_id && i.nombre === base.nombre);
  if (igual) {
    const item = { ...igual, cantidad: Math.min(MAX_CANTIDAD, igual.cantidad + cantidad) };
    return { ok: true, valor: { inv: { ...inv, inventario: inv.inventario.map((i) => (i === igual ? item : i)) }, item: { ...item, cantidad } } };
  }
  const item: ItemInventario = { ...base, instancia: nuevaInstancia(), cantidad };
  return { ok: true, valor: { inv: { ...inv, inventario: [...inv.inventario, item] }, item } };
}

/** Quita `cantidad` (o todo) de una instancia; si estaba equipada, la desequipa. */
export function quitarItem(inv: Inventario, instancia: string, cantidad?: number): Res<{ inv: Inventario; item: ItemInventario }> {
  const item = inv.inventario.find((i) => i.instancia === instancia);
  if (!item) return falla('No tiene ese objeto');
  const quedan = cantidad === undefined ? 0 : item.cantidad - cantidad;
  const inventario = quedan > 0 ? inv.inventario.map((i) => (i === item ? { ...i, cantidad: quedan } : i)) : inv.inventario.filter((i) => i !== item);
  const equipo = quedan > 0 ? inv.equipo : Object.fromEntries(Object.entries(inv.equipo).filter(([, v]) => v !== instancia));
  return { ok: true, valor: { inv: { ...inv, inventario, equipo }, item: { ...item, cantidad: cantidad ?? item.cantidad } } };
}

/** Equipa un arma, armadura o escudo propio. Las armaduras pesadas exigen la FUE mínima. */
export function equipar(inv: Inventario, instancia: string, car: Caracteristicas): Res<Inventario> {
  const item = inv.inventario.find((i) => i.instancia === instancia);
  if (!item) return falla('No tiene ese objeto');
  if (item.tipo !== 'arma' && item.tipo !== 'armadura' && item.tipo !== 'escudo') return falla('Ese objeto no se puede equipar');
  const fueMin = CATALOGO[item.item_id]?.armadura?.fue_min;
  if (fueMin && car.fue < fueMin) return falla(`${item.nombre} exige FUE ${fueMin}`);
  return { ok: true, valor: { ...inv, equipo: { ...inv.equipo, [item.tipo]: instancia } } };
}

export function desequipar(inv: Inventario, ranura: keyof Equipo): Inventario {
  return { ...inv, equipo: Object.fromEntries(Object.entries(inv.equipo).filter(([k]) => k !== ranura)) };
}

/** Bebe una poción: devuelve la notación de curación para que el servidor la tire, y consume una. */
export function beberPocion(inv: Inventario, instancia: string): Res<{ inv: Inventario; curacion: string; nombre: string }> {
  const item = inv.inventario.find((i) => i.instancia === instancia);
  const curacion = item && CATALOGO[item.item_id]?.curacion;
  if (!item || !curacion) return falla('Eso no es una poción que tengas');
  const r = quitarItem(inv, instancia, 1);
  return r.ok ? { ok: true, valor: { inv: r.valor.inv, curacion, nombre: item.nombre } } : r;
}

export type PedidoHabilidad = { rasgo_id: string } | {
  custom: { nombre: string; descripcion?: string; uso: UsoHabilidad; usos_max?: number; recarga?: Recarga; modificador?: { a: ObjetivoModificador; valor: number } };
};

export function otorgarHabilidad(inv: Inventario, pedido: PedidoHabilidad, nuevaInstancia: () => string): Res<{ inv: Inventario; habilidad: HabilidadPj }> {
  let h: Omit<HabilidadPj, 'instancia'>;
  if ('rasgo_id' in pedido) {
    const c = RASGOS[pedido.rasgo_id];
    if (!c) return falla('Esa habilidad no está en el catálogo');
    if (inv.habilidades.some((x) => x.rasgo_id === c.id)) return falla(`Ya tiene ${c.nombre}`);
    h = { rasgo_id: c.id, nombre: c.nombre, descripcion: c.descripcion, uso: c.uso, ...(c.recarga && { recarga: c.recarga }), usos_max: c.usos_max, usos_restantes: c.usos_max };
  } else {
    const c = pedido.custom;
    const nombre = c.nombre?.trim().slice(0, 60);
    if (!nombre) return falla('La habilidad necesita un nombre');
    if (!['a_voluntad', 'por_descanso', 'una_vez'].includes(c.uso)) return falla('Uso inválido');
    const usos = c.uso === 'a_voluntad' ? 0 : c.uso === 'una_vez' ? 1 : Math.min(10, Math.max(1, c.usos_max ?? 1));
    const mod = c.modificador;
    if (mod && (!['ataque', 'ca', 'dano'].includes(mod.a) || !Number.isInteger(mod.valor) || Math.abs(mod.valor) > 3)) return falla('El modificador va de -3 a +3 sobre ataque, CA o daño');
    h = {
      rasgo_id: 'custom', nombre, descripcion: (c.descripcion ?? '').trim().slice(0, 300), uso: c.uso, usos_max: usos, usos_restantes: usos,
      ...(c.uso === 'por_descanso' && { recarga: c.recarga ?? 'largo' }), ...(mod && mod.valor !== 0 && { modificador: mod }),
    };
  }
  const habilidad = { ...h, instancia: nuevaInstancia() };
  return { ok: true, valor: { inv: { ...inv, habilidades: [...inv.habilidades, habilidad] }, habilidad } };
}

export function quitarHabilidad(inv: Inventario, instancia: string): Res<{ inv: Inventario; habilidad: HabilidadPj }> {
  const habilidad = inv.habilidades.find((h) => h.instancia === instancia);
  if (!habilidad) return falla('No tiene esa habilidad');
  return { ok: true, valor: { inv: { ...inv, habilidades: inv.habilidades.filter((h) => h !== habilidad) }, habilidad } };
}

/** Usa una habilidad: las limitadas gastan un uso; sin usos, se rechaza. */
export function usarHabilidad(inv: Inventario, instancia: string): Res<{ inv: Inventario; habilidad: HabilidadPj }> {
  const h = inv.habilidades.find((x) => x.instancia === instancia);
  if (!h) return falla('No tiene esa habilidad');
  if (h.uso !== 'a_voluntad' && h.usos_restantes <= 0) return falla(`${h.nombre} no tiene usos: necesita ${h.uso === 'una_vez' ? 'que el GM la renueve' : `un descanso ${h.recarga}`}`);
  const usada = h.uso === 'a_voluntad' ? h : { ...h, usos_restantes: h.usos_restantes - 1 };
  return { ok: true, valor: { inv: { ...inv, habilidades: inv.habilidades.map((x) => (x === h ? usada : x)) }, habilidad: usada } };
}

/** Descanso corto: recupera las de recarga corta. Largo: todas las de "por descanso". Las de un solo uso, no. */
export function descanso(inv: Inventario, tipo: Recarga): Inventario {
  return {
    ...inv,
    habilidades: inv.habilidades.map((h) => (h.uso === 'por_descanso' && (tipo === 'largo' || h.recarga === 'corto') ? { ...h, usos_restantes: h.usos_max } : h)),
  };
}

/** Suma de los modificadores de habilidades sobre ataque, CA o daño. */
export const bonoHabilidades = (inv: Inventario, a: ObjetivoModificador) =>
  inv.habilidades.reduce((s, h) => s + (h.modificador?.a === a ? h.modificador.valor : 0), 0);
