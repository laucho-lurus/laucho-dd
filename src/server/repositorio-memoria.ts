import { randomUUID } from 'node:crypto';
import type { Monstruo } from '../rules/monstruos.ts';
import type { Campana, EstadoSesion, Evento, NuevaImagen, NuevoEvento, Personaje, Repositorio, Sesion } from './repositorio.ts';

export interface DatosIniciales {
  campanas?: Campana[];
  personajes?: Personaje[];
}

/** Repositorio en memoria: para tests y para `npm run dev` sin base de datos. */
export class RepositorioMemoria implements Repositorio {
  private readonly campanas: ReadonlyMap<string, Campana>;
  private personajes: readonly Personaje[];
  private readonly sesiones = new Map<string, Sesion>(); // por código
  private readonly eventos: Evento[] = [];
  private readonly encuentros = new Map<string, Monstruo[]>(); // sesion_id → monstruos

  constructor(datos: DatosIniciales = {}) {
    this.campanas = new Map((datos.campanas ?? []).map((c) => [c.id, c]));
    this.personajes = datos.personajes ?? [];
  }

  async listarCampanas() {
    return [...this.campanas.values()];
  }

  async crearPersonaje(personaje: Personaje, imagen: NuevaImagen | null) {
    const guardado = { ...personaje, imagen_url: imagen ? `/${imagen.ruta}` : null };
    this.personajes = [...this.personajes, guardado];
    return guardado;
  }

  async guardarPg(personajeId: string, pgActual: number) {
    this.personajes = this.personajes.map((p) => (p.id === personajeId ? { ...p, pg_actual: pgActual } : p));
  }

  async buscarCampana(id: string) {
    return this.campanas.get(id) ?? null;
  }

  async personajesDeCampana(campanaId: string) {
    return this.personajes.filter((p) => p.campana_id === campanaId);
  }

  async crearSesion(campanaId: string, codigo: string) {
    if (this.sesiones.has(codigo)) return null;
    const sesion: Sesion = { id: randomUUID(), codigo, campana_id: campanaId, estado: 'abierta' };
    this.sesiones.set(codigo, sesion);
    return sesion;
  }

  async buscarSesionPorCodigo(codigo: string) {
    return this.sesiones.get(codigo) ?? null;
  }

  async guardarEstadoSesion(sesionId: string, estado: EstadoSesion) {
    for (const [codigo, s] of this.sesiones) if (s.id === sesionId) this.sesiones.set(codigo, { ...s, ...estado });
  }

  async criaturasDeCampana() {
    return []; // la demo usa el SRD local
  }

  async monstruosDeSesion(sesionId: string) {
    return this.encuentros.get(sesionId) ?? [];
  }

  async guardarMonstruos(sesionId: string, monstruos: Monstruo[]) {
    this.encuentros.set(sesionId, monstruos.map((m) => ({ ...m })));
  }

  async avisosBase() {
    return [];
  }

  async registrarEvento(nuevo: NuevoEvento) {
    const evento: Evento = { ...nuevo, id: this.eventos.length + 1, creado_en: new Date().toISOString() };
    this.eventos.push(evento);
    return evento;
  }

  async ultimosEventos(sesionId: string, limite: number) {
    return this.eventos.filter((e) => e.sesion_id === sesionId).slice(-limite);
  }

  /** Solo para tests: todos los eventos guardados. */
  todosLosEventos(): readonly Evento[] {
    return this.eventos;
  }
}
