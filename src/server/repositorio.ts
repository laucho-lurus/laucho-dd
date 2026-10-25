// Acceso a datos del servidor de salas. Dos implementaciones:
// memoria (tests y desarrollo) y Postgres/Neon (producción).

import type { Diagrama, Variables } from '../rules/aventura.ts';

export interface Campana {
  id: string;
  nombre: string;
  diagrama?: Diagrama;
  variables?: Variables;
  resumen?: string;
}

export interface Personaje {
  id: string;
  campana_id: string;
  nombre: string;
  raza: string;
  clase: string;
  nivel: number;
  caracteristicas: Caracteristicas;
  pg_max: number;
  pg_actual: number;
  datos: DatosPersonaje;
  descripcion?: string;
  imagen_url?: string | null; // p. ej. "/uploads/<uuid>.png"
}

/** Imagen ya guardada en disco, lista para registrar en la tabla imagenes. */
export interface NuevaImagen {
  ruta: string; // relativa a la raíz del proyecto: "uploads/<archivo>"
}

export interface Caracteristicas {
  fue: number;
  des: number;
  con: number;
  int: number;
  sab: number;
  car: number;
}

export interface Arma {
  nombre: string;
  ataque: string; // p. ej. "+5"
  dano: string; // p. ej. "1d8+3 cortante"
}

/** Columna personajes.datos: lo que no tiene columna propia. */
export interface DatosPersonaje {
  ca?: number;
  armas?: Arma[];
  [clave: string]: unknown;
}

export interface Sesion {
  id: string;
  codigo: string;
  campana_id: string;
  estado: string;
}

/** Tipos permitidos por la columna eventos.tipo (ver db/schema.sql). */
export type TipoEvento = 'mensaje' | 'accion' | 'tirada' | 'estado' | 'intervencion_gm';

export interface NuevoEvento {
  sesion_id: string;
  tipo: TipoEvento;
  autor: string; // 'gm', 'sistema' o 'personaje:<uuid>'
  datos: Record<string, unknown>;
}

export interface Evento extends NuevoEvento {
  id: number;
  creado_en: string; // ISO 8601
}

export interface Repositorio {
  listarCampanas(): Promise<Campana[]>;
  /** Guarda el personaje (y su imagen, si tiene) y lo devuelve con imagen_url. */
  crearPersonaje(personaje: Personaje, imagen: NuevaImagen | null): Promise<Personaje>;
  guardarPg(personajeId: string, pgActual: number): Promise<void>;
  buscarCampana(id: string): Promise<Campana | null>;
  personajesDeCampana(campanaId: string): Promise<Personaje[]>;
  /** Crea la sesión. Devuelve null si el código ya existe. */
  crearSesion(campanaId: string, codigo: string): Promise<Sesion | null>;
  buscarSesionPorCodigo(codigo: string): Promise<Sesion | null>;
  registrarEvento(evento: NuevoEvento): Promise<Evento>;
  /** Últimos eventos de la sesión, del más viejo al más nuevo. */
  ultimosEventos(sesionId: string, limite: number): Promise<Evento[]>;
}
