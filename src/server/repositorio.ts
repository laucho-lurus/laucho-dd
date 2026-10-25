// Acceso a datos del servidor de salas. Dos implementaciones:
// memoria (tests y desarrollo) y Postgres/Neon (producción).

export interface Campana {
  id: string;
  nombre: string;
}

export interface Personaje {
  id: string;
  campana_id: string;
  nombre: string;
  raza: string;
  clase: string;
  nivel: number;
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
  buscarCampana(id: string): Promise<Campana | null>;
  personajesDeCampana(campanaId: string): Promise<Personaje[]>;
  /** Crea la sesión. Devuelve null si el código ya existe. */
  crearSesion(campanaId: string, codigo: string): Promise<Sesion | null>;
  buscarSesionPorCodigo(codigo: string): Promise<Sesion | null>;
  registrarEvento(evento: NuevoEvento): Promise<Evento>;
  /** Últimos eventos de la sesión, del más viejo al más nuevo. */
  ultimosEventos(sesionId: string, limite: number): Promise<Evento[]>;
}
