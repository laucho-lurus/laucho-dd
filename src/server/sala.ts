import type { Arma, Campana, Caracteristicas, Personaje, Sesion } from './repositorio.ts';
import { buscarNodo, DIAGRAMA_VACIO, nodoInicial, type Diagrama, type Variables } from '../rules/aventura.ts';
import type { PerfilGm } from '../ia/perfiles.ts';

/** GM IA de la sala: el GM humano sigue al mando y puede pausarlo. */
export interface IaSala {
  perfil: PerfilGm;
  pausada: boolean;
  en_curso: Promise<void> | null;
  ultima: number[]; // ids de eventos de su última intervención (para deshacer)
}

export const MAX_JUGADORES = 6;

/** Lo único que la sala necesita de una conexión: poder enviarle un mensaje. */
export interface Cliente {
  enviar(mensaje: object): void;
}

export type Rol = { rol: 'gm' } | { rol: 'jugador'; personaje_id: string };

export interface EstadoJugador {
  personaje_id: string;
  nombre: string;
  raza: string;
  clase: string;
  nivel: number;
  caracteristicas: Caracteristicas;
  pg_max: number;
  pg_actual: number;
  inconsciente: boolean;
  tirada_pendiente: { notacion: string; motivo: string | null } | null;
  ca: number | null;
  armas: Arma[];
  imagen_url: string | null;
  conectado: boolean;
}

export interface EstadoSala {
  codigo: string;
  campana: Pick<Campana, 'id' | 'nombre'>;
  gm_conectado: boolean;
  jugadores: EstadoJugador[];
  orden: string[];
  turno_de: string | null;
  ronda: number;
  max_jugadores: number;
}

/** Tirada que el GM pidió a un jugador. La CD solo la conoce el servidor (y el GM). */
export interface Peticion {
  notacion: string;
  motivo: string | null;
  cd: number | null;
}

type Resultado = { ok: true } | { ok: false; error: string };
const ok: Resultado = { ok: true };
const error = (e: string): Resultado => ({ ok: false, error: e });

/**
 * Estado en memoria de una sala de juego. Es la fuente de verdad mientras el servidor vive.
 * Los asientos se identifican por personaje: quien vuelve con el mismo personaje retoma el suyo.
 */
export class Sala {
  readonly sesion: Sesion;
  readonly campana: Campana;
  private personajes: ReadonlyMap<string, Personaje>;
  private readonly tokenGm: string | null;
  private gm: Cliente | null = null;
  private readonly asientos = new Map<string, Cliente | null>(); // personaje_id → conexión (null = desconectado)
  private readonly pg = new Map<string, number>(); // personaje_id → PG actuales
  private readonly peticiones = new Map<string, Peticion>(); // personaje_id → tirada pedida
  private orden: string[] = [];
  private turno = 0;
  private ronda = 1;
  private cola: Promise<unknown> = Promise.resolve();
  readonly diagrama: Diagrama;
  private nodo: string | null;
  private vars: Variables;
  ia: IaSala | null = null;

  constructor(sesion: Sesion, campana: Campana, personajes: Personaje[], tokenGm: string | null) {
    this.sesion = sesion;
    this.campana = campana;
    this.personajes = new Map(personajes.map((p) => [p.id, p]));
    this.tokenGm = tokenGm;
    for (const p of personajes) this.pg.set(p.id, p.pg_actual);
    this.diagrama = campana.diagrama ?? DIAGRAMA_VACIO;
    this.nodo = nodoInicial(this.diagrama)?.id ?? null;
    this.vars = { ...(campana.variables ?? {}) };
  }

  nodoActual() {
    return this.nodo;
  }

  variables(): Variables {
    return { ...this.vars };
  }

  cambiarNodo(id: string): Resultado {
    if (!buscarNodo(this.diagrama, id)) return error('Ese nodo no existe en la campaña');
    this.nodo = id;
    return ok;
  }

  fijarVariable(nombre: string, valor: boolean | number | string): Resultado {
    if (!Object.hasOwn(this.vars, nombre)) return error('Esa variable no existe');
    this.vars = { ...this.vars, [nombre]: valor };
    return ok;
  }

  hayGm() {
    return this.gm !== null;
  }

  /** Mensaje solo para el GM humano (notas, gasto, nodo actual). */
  enviarGm(mensaje: object) {
    this.gm?.enviar(mensaje);
  }

  /** Ejecuta las tareas de la sala de a una, en orden de llegada, aunque sean asíncronas. */
  encolar<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(tarea);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  /** Suma personajes creados después de abrir la sala. */
  incorporar(personajes: Personaje[]) {
    const nuevos = personajes.filter((p) => !this.personajes.has(p.id));
    if (nuevos.length === 0) return;
    this.personajes = new Map([...this.personajes, ...nuevos.map((p): [string, Personaje] => [p.id, p])]);
    for (const p of nuevos) this.pg.set(p.id, p.pg_actual);
  }

  personaje(id: string): Personaje | undefined {
    return this.personajes.get(id);
  }

  listaPersonajes() {
    return [...this.personajes.values()].map((p) => ({
      id: p.id,
      nombre: p.nombre,
      raza: p.raza,
      clase: p.clase,
      nivel: p.nivel,
      imagen_url: p.imagen_url ?? null,
      ocupado: this.asientos.get(p.id) != null,
    }));
  }

  sentarGm(cliente: Cliente, token: string | null): Resultado {
    if (this.tokenGm === null || token !== this.tokenGm) return error('Token de GM incorrecto');
    if (this.gm) return error('El GM ya está conectado');
    this.gm = cliente;
    return ok;
  }

  sentarJugador(personajeId: string, cliente: Cliente): Resultado {
    if (!this.personajes.has(personajeId)) return error('Ese personaje no es de esta campaña');
    if (this.asientos.has(personajeId)) {
      if (this.asientos.get(personajeId)) return error('Ese personaje ya está en juego');
      this.asientos.set(personajeId, cliente); // reconexión: retoma su asiento
      return ok;
    }
    if (this.asientos.size >= MAX_JUGADORES) return error(`La sala está llena (máximo ${MAX_JUGADORES} jugadores)`);
    this.asientos.set(personajeId, cliente);
    this.orden = [...this.orden, personajeId]; // por defecto, orden de llegada
    return ok;
  }

  /** Marca como desconectado al cliente. El asiento se conserva. */
  levantar(cliente: Cliente) {
    if (this.gm === cliente) this.gm = null;
    for (const [id, c] of this.asientos) if (c === cliente) this.asientos.set(id, null);
  }

  pedirTirada(personajeId: string, peticion: Peticion): Resultado {
    if (!this.asientos.has(personajeId)) return error('Ese personaje no está en la sala');
    this.peticiones.set(personajeId, peticion);
    return ok;
  }

  /** Saca la petición pendiente del personaje (se consume con una sola tirada). */
  tomarPeticion(personajeId: string): Peticion | null {
    const p = this.peticiones.get(personajeId) ?? null;
    this.peticiones.delete(personajeId);
    return p;
  }

  /** Suma o resta PG sin bajar de 0 ni pasar del máximo. Devuelve los PG resultantes. */
  aplicarPg(personajeId: string, cantidad: number): { ok: true; pg: number } | { ok: false; error: string } {
    const p = this.personajes.get(personajeId);
    if (!p || !this.asientos.has(personajeId)) return { ok: false, error: 'Ese personaje no está en la sala' };
    const pg = Math.max(0, Math.min(p.pg_max, (this.pg.get(personajeId) ?? 0) + cantidad));
    this.pg.set(personajeId, pg);
    return { ok: true, pg };
  }

  rolDe(cliente: Cliente): Rol | null {
    if (this.gm === cliente) return { rol: 'gm' };
    for (const [id, c] of this.asientos) if (c === cliente) return { rol: 'jugador', personaje_id: id };
    return null;
  }

  turnoDe(): string | null {
    return this.orden[this.turno] ?? null;
  }

  definirOrden(orden: string[]): Resultado {
    if (new Set(orden).size !== orden.length) return error('El orden tiene personajes repetidos');
    const ajeno = orden.find((id) => !this.asientos.has(id));
    if (ajeno) return error('El orden incluye un personaje que no está en la sala');
    this.orden = [...orden];
    this.turno = 0;
    this.ronda = 1;
    return ok;
  }

  siguienteTurno(): Resultado {
    if (this.orden.length === 0) return error('No hay orden de turnos');
    this.turno += 1;
    if (this.turno >= this.orden.length) {
      this.turno = 0;
      this.ronda += 1;
    }
    return ok;
  }

  estado(): EstadoSala {
    return {
      codigo: this.sesion.codigo,
      campana: { id: this.campana.id, nombre: this.campana.nombre }, // sin diagrama: las notas son del GM
      gm_conectado: this.gm !== null,
      jugadores: [...this.asientos].map(([id, c]) => {
        const p = this.personajes.get(id)!;
        return {
          personaje_id: id,
          nombre: p.nombre,
          raza: p.raza,
          clase: p.clase,
          nivel: p.nivel,
          caracteristicas: p.caracteristicas,
          pg_max: p.pg_max,
          pg_actual: this.pg.get(id)!,
          inconsciente: this.pg.get(id) === 0,
          tirada_pendiente: this.peticionPublica(id),
          ca: p.datos.ca ?? null,
          armas: p.datos.armas ?? [],
          imagen_url: p.imagen_url ?? null,
          conectado: c !== null,
        };
      }),
      orden: [...this.orden],
      turno_de: this.turnoDe(),
      ronda: this.ronda,
      max_jugadores: MAX_JUGADORES,
    };
  }

  private peticionPublica(id: string) {
    const p = this.peticiones.get(id);
    return p ? { notacion: p.notacion, motivo: p.motivo } : null;
  }

  /** Envía el mensaje a todos los conectados (GM y jugadores). */
  difundir(mensaje: object) {
    if (this.gm) this.gm.enviar(mensaje);
    for (const c of this.asientos.values()) if (c) c.enviar(mensaje);
  }
}
