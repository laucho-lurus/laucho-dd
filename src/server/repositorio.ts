// Acceso a datos del servidor de salas. Dos implementaciones:
// memoria (tests y desarrollo) y Postgres/Neon (producción).

import type { Diagrama, Variables } from '../rules/aventura.ts';
import type { Monstruo, Plantilla } from '../rules/monstruos.ts';
import type { Mapa } from '../rules/mapa.ts';

/** Lo que se guarda del encuentro activo de una sesión (encuentros.participantes). */
export interface Encuentro {
  monstruos: Monstruo[];
  mapa: Mapa | null;
}

export const MIGRACION_001 = 'Falta aplicar la migración 001 (db/migraciones/001_sesiones_variables.sql)';
export const MIGRACION_002 = 'Falta aplicar la migración 002 (db/migraciones/002_gm_token.sql): el GM no podrá volver a entrar tras reiniciar';

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
  nodo_actual?: string | null;
  variables?: Variables | null; // null: la base aún no tiene la columna (migración 001)
  ia_pausada?: boolean;
  ia_perfil_id?: string | null;
  gm_token_hash?: string | null; // SHA-256 del token del GM (migración 002)
}

/** Estado de la partida que se guarda para poder retomarla. */
export interface EstadoSesion {
  nodo_actual: string | null;
  variables: Variables;
  ia_pausada: boolean;
  ia_perfil_id: string | null;
}

/** Valores de eventos.tipo (columna de texto libre en db/schema.sql). */
export type TipoEvento = 'mensaje' | 'accion' | 'tirada' | 'estado' | 'intervencion_gm' | 'sistema' | 'chat';

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
  /** Crea (sin id) o actualiza la campaña del editor: nombre, diagrama, variables y resumen. */
  guardarCampana(id: string | null, datos: Required<Omit<Campana, 'id'>>): Promise<Campana>;
  personajesDeCampana(campanaId: string): Promise<Personaje[]>;
  /** Crea la sesión. Devuelve null si el código ya existe. */
  crearSesion(campanaId: string, codigo: string): Promise<Sesion | null>;
  buscarSesionPorCodigo(codigo: string): Promise<Sesion | null>;
  /** Guarda nodo, variables y estado de la IA. Sin la migración 001 solo guarda el nodo. */
  guardarEstadoSesion(sesionId: string, estado: EstadoSesion): Promise<void>;
  /** Guarda el hash del token del GM. Sin la migración 002 no hace nada (queda solo en memoria). */
  guardarTokenGm(sesionId: string, hash: string): Promise<void>;
  /** Criaturas disponibles para la campaña (tabla criaturas: de la campaña o globales). */
  criaturasDeCampana(campanaId: string): Promise<Plantilla[]>;
  /** Monstruos y mapa del encuentro activo de la sesión (encuentros.participantes). */
  encuentroDeSesion(sesionId: string): Promise<Encuentro>;
  guardarEncuentro(sesionId: string, encuentro: Encuentro): Promise<void>;
  /** Avisos para el GM sobre la base de datos (p. ej. migraciones pendientes). */
  avisosBase(): Promise<string[]>;
  registrarEvento(evento: NuevoEvento): Promise<Evento>;
  /** Últimos eventos de la sesión, del más viejo al más nuevo. */
  ultimosEventos(sesionId: string, limite: number): Promise<Evento[]>;
}
