// Subida, listado y borrado de imágenes del GM: criaturas, PNJ, escenas, fondos de mapa y retratos.
import { randomUUID } from 'node:crypto';
import { clavePertenencia, imagenesDeCampana, type Pertenencia } from '../rules/imagenes.ts';
import { unirCriaturas } from '../rules/monstruos.ts';
import { leerImagen } from './creacion.ts';
import type { Almacen } from './almacen.ts';
import type { Repositorio } from './repositorio.ts';

export const MAX_IMAGEN_GM_BYTES = 5 * 1024 * 1024;

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

const url = (ruta: string) => `/${ruta}`;
const archivoDe = (ruta: string) => ruta.replace(/^uploads\//, '');

export async function subirImagen(repo: Repositorio, almacen: Almacen, cuerpo: unknown): Promise<Res<{ id: string; url: string; pertenece_a: string }>> {
  const o = cuerpo as { pertenece?: Partial<Pertenencia>; imagen?: unknown } | null;
  const clave = clavePertenencia(o?.pertenece);
  if (typeof clave !== 'string') return { ok: false, error: clave.error };
  // Tipo real por la cabecera del archivo, no por la extensión ni por lo que diga el navegador.
  const imagen = leerImagen(o?.imagen, MAX_IMAGEN_GM_BYTES);
  if (!imagen.ok) return imagen;
  const archivo = `${randomUUID()}.${imagen.valor.ext}`; // el nombre original no se usa: nada que sanear ni que pise otro
  await almacen.guardar(archivo, imagen.valor.contenido);
  const { imagen: fila, reemplazadas } = await repo.registrarImagen(clave, `uploads/${archivo}`);
  for (const r of reemplazadas) await almacen.borrar(archivoDe(r)).catch(() => {});
  return { ok: true, valor: { id: fila.id, url: url(fila.ruta), pertenece_a: fila.pertenece_a } };
}

export async function borrarImagen(repo: Repositorio, almacen: Almacen, id: string): Promise<boolean> {
  const ruta = await repo.borrarImagen(id);
  if (ruta) await almacen.borrar(archivoDe(ruta)).catch(() => {});
  return ruta !== null;
}

/** Lo que necesita la página /imagenes: las de la campaña, la checklist y las opciones de los desplegables. */
export async function imagenesDeLaCampana(repo: Repositorio, campanaId: string) {
  const campana = await repo.buscarCampana(campanaId);
  if (!campana) return null;
  const diagrama = campana.diagrama ?? { nodos: [], flechas: [] };
  const criaturas = unirCriaturas(await repo.criaturasDeCampana(campanaId));
  const personajes = await repo.personajesDeCampana(campanaId);
  const imagenes = await repo.listarImagenes(['criatura:', `nodo:${campanaId}:`, `pnj:${campanaId}:`, `fondo:${campanaId}:`, ...personajes.map((p) => `personaje:${p.id}`)]);
  const porDueno = new Map(imagenes.map((i) => [i.pertenece_a, i]));
  const propias = new Set((await repo.criaturasDeCampana(campanaId)).map((c) => c.srd_clave));
  return {
    imagenes: imagenes.map((i) => ({ id: i.id, url: url(i.ruta), pertenece_a: i.pertenece_a })),
    // Checklist: solo las criaturas de la campaña (no todo el SRD), más las escenas y los PNJ.
    pendientes: imagenesDeCampana(campanaId, diagrama, criaturas.filter((c) => propias.has(c.srd_clave)))
      .map((p) => ({ ...p, url: porDueno.has(p.pertenece_a) ? url(porDueno.get(p.pertenece_a)!.ruta) : null, id: porDueno.get(p.pertenece_a)?.id ?? null })),
    opciones: {
      criaturas: criaturas.map(({ srd_clave, nombre }) => ({ srd_clave, nombre })),
      nodos: diagrama.nodos.map(({ id, titulo, tipo }) => ({ id, titulo, tipo })),
      personajes: personajes.map(({ id, nombre }) => ({ id, nombre })),
    },
  };
}
