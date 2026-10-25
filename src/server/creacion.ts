// Creación de personajes: valida lo que manda el cliente, calcula derivados y guarda.
import { randomBytes, randomUUID } from 'node:crypto';
import { roll } from '../rules/dice.ts';
import {
  ALINEAMIENTOS, aplicarBonos, CARACTERISTICAS, CLASES, derivados, METODOS, RAZAS, validarCaracteristicas,
  type Metodo,
} from '../rules/personaje.ts';
import type { Caracteristicas, Personaje, Repositorio } from './repositorio.ts';

export const MAX_IMAGEN_BYTES = 2 * 1024 * 1024;
const TIRADAS_VIGENCIA_MS = 30 * 60_000;
const MAX_NOMBRE = 60;
const MAX_TRASFONDO = 80;
const MAX_DESCRIPCION = 4000;

/** Firmas de los formatos aceptados (los primeros bytes del archivo). */
const FORMATOS: { ext: string; es: (b: Buffer) => boolean }[] = [
  { ext: 'png', es: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', es: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', es: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

export type GuardarArchivo = (nombre: string, contenido: Buffer) => Promise<void>;

type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };
const falla = <T>(error: string): Resultado<T> => ({ ok: false, error });

/** 4d6 quitando el menor, tirado en el servidor. El cliente solo recibe un token para usarlos. */
export class TiradasCaracteristicas {
  private readonly pendientes = new Map<string, { valores: number[]; expira: number }>();
  private readonly ahora: () => number;

  constructor(ahora: () => number = Date.now) {
    this.ahora = ahora;
  }

  tirar(): { token: string; valores: number[] } {
    this.limpiar();
    const valores = CARACTERISTICAS.map(() => roll('4d6kh3').total);
    const token = randomBytes(16).toString('hex');
    this.pendientes.set(token, { valores, expira: this.ahora() + TIRADAS_VIGENCIA_MS });
    return { token, valores };
  }

  /** Valores de la tirada, o undefined si el token no existe o venció. No la consume. */
  ver(token: string): number[] | undefined {
    const t = this.pendientes.get(token);
    return t && t.expira > this.ahora() ? t.valores : undefined;
  }

  consumir(token: string) {
    this.pendientes.delete(token);
  }

  private limpiar() {
    const ahora = this.ahora();
    for (const [token, t] of this.pendientes) if (t.expira <= ahora) this.pendientes.delete(token);
  }
}

/** Decodifica una imagen en data URL y comprueba tamaño y formato real. */
export function leerImagen(dataUrl: unknown, max = MAX_IMAGEN_BYTES): Resultado<{ ext: string; contenido: Buffer }> {
  if (typeof dataUrl !== 'string') return falla('La imagen no es válida');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return falla('La imagen debe ser PNG, JPG o WEBP');
  if ((m[2].length * 3) / 4 > max + 3) return falla(`La imagen supera ${max / (1024 * 1024)} MB`);
  const contenido = Buffer.from(m[2], 'base64');
  if (contenido.length > max) return falla(`La imagen supera ${max / (1024 * 1024)} MB`);
  const formato = FORMATOS.find((f) => f.es(contenido));
  if (!formato) return falla('El archivo no es una imagen PNG, JPG o WEBP');
  return { ok: true, valor: { ext: formato.ext, contenido } };
}

const textoCorto = (v: unknown, max: number, opcional = false): string | null => {
  if (v === undefined || v === null || v === '') return opcional ? '' : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return (t || opcional) && t.length <= max ? t : null;
};

const clave = <T>(tabla: Readonly<Record<string, T>>, v: unknown): T | undefined =>
  typeof v === 'string' && Object.hasOwn(tabla, v) ? tabla[v] : undefined;

function leerCaracteristicas(v: unknown): Caracteristicas | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!CARACTERISTICAS.every((c) => typeof o[c] === 'number')) return null;
  return Object.fromEntries(CARACTERISTICAS.map((c) => [c, o[c]])) as unknown as Caracteristicas;
}

export interface Dependencias {
  repo: Repositorio;
  tiradas: TiradasCaracteristicas;
  guardarArchivo: GuardarArchivo;
}

/** Valida la petición del cliente y crea el personaje de nivel 1. */
export async function crearPersonaje(deps: Dependencias, cuerpo: unknown): Promise<Resultado<Personaje>> {
  if (typeof cuerpo !== 'object' || cuerpo === null) return falla('Petición inválida');
  const e = cuerpo as Record<string, unknown>;

  const nombre = textoCorto(e.nombre, MAX_NOMBRE);
  if (!nombre) return falla(`El nombre es obligatorio (máximo ${MAX_NOMBRE} caracteres)`);
  const raza = clave(RAZAS, e.raza);
  if (!raza) return falla('Elige una raza de la lista');
  const clase = clave(CLASES, e.clase);
  if (!clase) return falla('Elige una clase de la lista');
  const trasfondo = textoCorto(e.trasfondo, MAX_TRASFONDO, true);
  if (trasfondo === null) return falla(`El trasfondo admite hasta ${MAX_TRASFONDO} caracteres`);
  if (typeof e.alineamiento !== 'string' || !(ALINEAMIENTOS as readonly string[]).includes(e.alineamiento)) {
    return falla('Elige un alineamiento de la lista');
  }
  const descripcion = textoCorto(e.descripcion, MAX_DESCRIPCION, true);
  if (descripcion === null) return falla(`La descripción admite hasta ${MAX_DESCRIPCION} caracteres`);
  const campana = typeof e.campana_id === 'string' ? await deps.repo.buscarCampana(e.campana_id) : null;
  if (!campana) return falla('Elige una campaña de la lista');

  if (!(METODOS as readonly unknown[]).includes(e.metodo)) return falla('Método de características desconocido');
  const metodo = e.metodo as Metodo;
  const base = leerCaracteristicas(e.caracteristicas);
  if (!base) return falla('Faltan las características');
  const token = typeof e.token_tiradas === 'string' ? e.token_tiradas : '';
  const tiradas = metodo === 'aleatorio' ? deps.tiradas.ver(token) : undefined;
  const errorCar = validarCaracteristicas(metodo, base, tiradas);
  if (errorCar) return falla(errorCar);

  const imagen = e.imagen ? leerImagen(e.imagen) : null;
  if (imagen && !imagen.ok) return imagen;

  const caracteristicas = aplicarBonos(base, raza);
  const d = derivados(caracteristicas, clase);
  const personaje: Personaje = {
    id: randomUUID(),
    campana_id: campana.id,
    nombre,
    descripcion,
    raza: raza.nombre,
    clase: clase.nombre,
    nivel: 1,
    caracteristicas,
    pg_max: d.pg_max,
    pg_actual: d.pg_max,
    datos: {
      ca: d.ca,
      armas: d.armas,
      salvaciones: d.salvaciones,
      trasfondo,
      alineamiento: e.alineamiento,
      metodo,
      caracteristicas_base: base,
    },
  };

  let ruta: string | null = null;
  if (imagen) {
    const archivo = `${personaje.id}.${imagen.valor.ext}`;
    await deps.guardarArchivo(archivo, imagen.valor.contenido);
    ruta = `uploads/${archivo}`;
  }
  const guardado = await deps.repo.crearPersonaje(personaje, ruta ? { ruta } : null);
  if (metodo === 'aleatorio') deps.tiradas.consumir(token);
  return { ok: true, valor: guardado };
}
