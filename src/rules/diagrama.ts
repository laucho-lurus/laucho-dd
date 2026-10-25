// Editor de campañas: normalización de lo que manda el cliente, validación y reglas de conexión.
import { TIPOS_NODO, type Diagrama, type Flecha, type Nodo, type Variables } from './aventura.ts';

const MAX_NODOS = 300;
const MAX_TEXTO = 4000;

/** Cuántas salidas admite cada tipo (undefined = sin límite). */
export const MAX_SALIDAS: Partial<Record<string, number>> = { final: 0, tirada: 2, combate: 3 };

/** ¿Se puede añadir una flecha desde → hasta? Devuelve el motivo si no. */
export function puedeConectar(d: Diagrama, desde: string, hasta: string): string | null {
  const origen = d.nodos.find((n) => n.id === desde);
  if (!origen || !d.nodos.some((n) => n.id === hasta)) return 'El nodo no existe';
  if (desde === hasta) return 'Un nodo no puede conectarse consigo mismo';
  if (d.flechas.some((f) => f.desde === desde && f.hasta === hasta)) return 'Esa flecha ya existe';
  const max = origen.tipo === 'decision' ? Math.max(1, origen.opciones?.length ?? 0) : MAX_SALIDAS[origen.tipo];
  const salidas = d.flechas.filter((f) => f.desde === desde).length;
  if (max !== undefined && salidas >= max) {
    return max === 0 ? 'Un final no tiene salidas' : `Un nodo de tipo ${origen.tipo} admite como máximo ${max} salida${max === 1 ? '' : 's'}`;
  }
  return null;
}

/** Avisos (no bloquean el guardado). */
export function validarDiagrama(d: Diagrama, variables: Variables): string[] {
  const avisos: string[] = [];
  const ids = d.nodos.map((n) => n.id);
  const repetidos = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (repetidos.length) avisos.push(`Ids de nodo repetidos: ${repetidos.join(', ')}`);
  const existe = new Set(ids);
  for (const f of d.flechas) {
    if (!existe.has(f.desde) || !existe.has(f.hasta)) avisos.push(`Flecha rota: ${f.desde} → ${f.hasta} apunta a un nodo que no existe`);
    for (const e of f.efectos ?? []) {
      if (!Object.hasOwn(variables, e.variable)) avisos.push(`La flecha ${f.desde} → ${f.hasta} fija una variable que no existe: ${e.variable}`);
    }
  }
  if (!d.nodos.some((n) => n.tipo === 'final')) avisos.push('No hay ningún nodo final');
  if (!d.introduccion?.trim()) avisos.push('La campaña no tiene introducción de ambientación');
  else if (!/\{h[eé]roe(s|_\d+)\}/i.test(d.introduccion)) avisos.push('La introducción no nombra a los héroes: usa {heroes}');
  d.nodos.forEach((n, i) => {
    if (i > 0 && !d.flechas.some((f) => f.hasta === n.id)) avisos.push(`"${n.titulo || n.id}" no tiene entrada (nadie llega a él)`);
    if (n.tipo !== 'final' && !d.flechas.some((f) => f.desde === n.id)) avisos.push(`"${n.titulo || n.id}" no tiene salida`);
    if (n.disparador && !Object.hasOwn(variables, n.disparador.variable)) avisos.push(`"${n.titulo || n.id}" usa una variable que no existe: ${n.disparador.variable}`);
  });
  return avisos;
}

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

const texto = (v: unknown, max = MAX_TEXTO) => (typeof v === 'string' ? v.slice(0, max) : '');
const valorVar = (v: unknown): v is boolean | number | string => ['boolean', 'number', 'string'].includes(typeof v);
const asignacion = (v: unknown) => {
  const o = v as { variable?: unknown; valor?: unknown } | null;
  return o && typeof o.variable === 'string' && valorVar(o.valor) ? { variable: o.variable, valor: o.valor } : null;
};

function nodo(v: unknown): Nodo | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || !o.id.trim() || o.id.length > 64) return null;
  const tipo = (TIPOS_NODO as readonly unknown[]).includes(o.tipo) ? (o.tipo as string) : 'escena';
  const n: Nodo = { id: o.id, tipo, titulo: texto(o.titulo, 200), texto: texto(o.texto), notas: texto(o.notas) };
  if (Number.isFinite(o.x) && Number.isFinite(o.y)) Object.assign(n, { x: Math.round(o.x as number), y: Math.round(o.y as number) });
  if (typeof o.chequeo === 'string' && o.chequeo) n.chequeo = o.chequeo.slice(0, 40);
  if (Number.isInteger(o.cd) && (o.cd as number) >= 1 && (o.cd as number) <= 40) n.cd = o.cd as number;
  if (Array.isArray(o.monstruos)) {
    n.monstruos = o.monstruos
      .filter((m): m is { srd_clave: string; cantidad: number } => typeof m?.srd_clave === 'string' && Number.isInteger(m?.cantidad))
      .map((m) => ({ srd_clave: m.srd_clave, cantidad: Math.min(6, Math.max(1, m.cantidad)) }));
  }
  if (Array.isArray(o.opciones)) n.opciones = o.opciones.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200));
  for (const campo of ['pnj', 'sabe', 'quiere', 'recompensas'] as const) if (typeof o[campo] === 'string') n[campo] = texto(o[campo]);
  const disparador = asignacion(o.disparador);
  if (disparador) n.disparador = disparador;
  if (Number.isInteger(o.xp) && (o.xp as number) >= 0) n.xp = o.xp as number;
  return n;
}

function flecha(v: unknown): Flecha | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.desde !== 'string' || typeof o.hasta !== 'string') return null;
  const f: Flecha = { desde: o.desde, hasta: o.hasta, etiqueta: texto(o.etiqueta, 200) };
  if (typeof o.condicion === 'string' && o.condicion.trim()) f.condicion = texto(o.condicion, 300);
  if (Array.isArray(o.efectos)) {
    const efectos = o.efectos.map(asignacion).filter((e) => e !== null);
    if (efectos.length) f.efectos = efectos;
  }
  return f;
}

/** Limpia y valida la forma del diagrama y las variables que manda el editor. */
export function normalizarCampana(entrada: unknown): Res<{ nombre: string; diagrama: Diagrama; variables: Variables; resumen: string }> {
  const o = entrada as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: 'Campaña inválida' };
  const nombre = texto(o.nombre, 120).trim();
  if (!nombre) return { ok: false, error: 'La campaña necesita un nombre' };
  const d = o.diagrama as { nodos?: unknown; flechas?: unknown } | null;
  if (!d || !Array.isArray(d.nodos) || !Array.isArray(d.flechas)) return { ok: false, error: 'El diagrama debe tener "nodos" y "flechas"' };
  if (d.nodos.length > MAX_NODOS) return { ok: false, error: `Máximo ${MAX_NODOS} nodos` };
  const nodos = d.nodos.map(nodo);
  if (nodos.some((n) => n === null)) return { ok: false, error: 'Hay un nodo sin id válido' };
  const flechas = d.flechas.map(flecha);
  if (flechas.some((f) => f === null)) return { ok: false, error: 'Hay una flecha sin "desde" o "hasta"' };
  const vars = (o.variables ?? {}) as Record<string, unknown>;
  if (typeof vars !== 'object' || Array.isArray(vars)) return { ok: false, error: 'Variables inválidas' };
  const variables: Variables = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(k) || !valorVar(v)) return { ok: false, error: `Variable inválida: ${k}` };
    variables[k] = v;
  }
  const introduccion = texto((d as { introduccion?: unknown }).introduccion, 3000).trim();
  const diagrama: Diagrama = { nodos: nodos as Nodo[], flechas: flechas as Flecha[], ...(introduccion && { introduccion }) };
  return { ok: true, valor: { nombre, diagrama, variables, resumen: texto(o.resumen, 1000) } };
}
