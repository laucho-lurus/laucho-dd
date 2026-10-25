import { createHash, timingSafeEqual } from 'node:crypto';
import type { Arma, Campana, Caracteristicas, EstadoSesion, Personaje, Sesion } from './repositorio.ts';
import { buscarNodo, DIAGRAMA_VACIO, nodoInicial, type Diagrama, type Variables } from '../rules/aventura.ts';
import type { PerfilGm } from '../ia/perfiles.ts';
import { rellenarIntroduccion } from '../rules/introduccion.ts';
import { cambiarNiebla, crearMapa, moverFicha, quitarFicha, validarMovimiento, vistaJugadores, type Mapa, type Posicion } from '../rules/mapa.ts';
import { MAX_MONSTRUOS_VIVOS, monstruoPublico, type Monstruo, type Plantilla } from '../rules/monstruos.ts';

/** GM IA de la sala: el GM humano sigue al mando y puede pausarlo. */
export interface IaSala {
  perfil: PerfilGm;
  pausada: boolean;
  puede_pg: boolean; // casilla del GM: la IA puede aplicar daño/curación
  ultima: IntervencionIa; // lo que hizo en su última intervención (para deshacer)
  arrastre: IntervencionIa; // consecuencias que se suman a la próxima intervención (que las narra)
}

export interface IntervencionIa {
  eventos: number[];
  pg: { personaje_id: string; delta: number }[]; // cambios reales de PG (ya recortados a 0 y al máximo)
  monstruos: { id: string; delta: number }[]; // daño a monstruos de tiradas que pidió la IA
  agregados: string[]; // monstruos que sacó la IA
}

export const SIN_INTERVENCION: IntervencionIa = { eventos: [], pg: [], monstruos: [], agregados: [] };

export const unirIntervenciones = (a: IntervencionIa, b: Partial<IntervencionIa>): IntervencionIa => ({
  eventos: [...a.eventos, ...(b.eventos ?? [])],
  pg: [...a.pg, ...(b.pg ?? [])],
  monstruos: [...a.monstruos, ...(b.monstruos ?? [])],
  agregados: [...a.agregados, ...(b.agregados ?? [])],
});

export const intervencionVacia = (i: IntervencionIa) => i.eventos.length + i.pg.length + i.monstruos.length + i.agregados.length === 0;

export const MAX_JUGADORES = 6;

/** Solo se guarda el SHA-256 del token del GM, nunca el token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
  monstruos: ReturnType<typeof monstruoPublico>[]; // sin cifras: los PG exactos solo los ve el GM
  mapa: Mapa | null; // vista de jugadores: sin monstruos bajo la niebla
  que_sigue: string; // franja "Qué sigue", calculada sin IA
}

/** Tirada que el GM pidió a un jugador. La CD solo la conoce el servidor (y el GM). */
export interface Peticion {
  notacion: string;
  motivo: string | null;
  cd: number | null;
  objetivo_monstruo?: string | null;
  efecto?: 'ataque' | 'daño' | null;
  de_ia?: boolean;
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
  private readonly hashTokenGm: string | null;
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
  ia_pensando = false;
  /** Introducción de esta sesión (editada por el GM o generada por la IA); si no, la de la campaña. */
  introduccion: string | null;
  introduccion_mostrada = false;
  private monstruos: Monstruo[] = [];
  private mapa: Mapa | null = null;
  private proximoMonstruo = 1;

  constructor(sesion: Sesion, campana: Campana, personajes: Personaje[], hashTokenGm: string | null) {
    this.sesion = sesion;
    this.campana = campana;
    this.personajes = new Map(personajes.map((p) => [p.id, p]));
    this.hashTokenGm = hashTokenGm;
    for (const p of personajes) this.pg.set(p.id, p.pg_actual);
    this.diagrama = campana.diagrama ?? DIAGRAMA_VACIO;
    // Si la sesión ya tenía estado guardado (servidor reiniciado), se retoma desde ahí.
    this.nodo = buscarNodo(this.diagrama, sesion.nodo_actual ?? null)?.id ?? nodoInicial(this.diagrama)?.id ?? null;
    this.vars = { ...(campana.variables ?? {}), ...(sesion.variables ?? {}) };
    this.introduccion = sesion.introduccion ?? null;
  }

  plantillaIntroduccion(): string | null {
    return this.introduccion?.trim() || this.diagrama.introduccion?.trim() || null;
  }

  /** La introducción con los nombres de los personajes sentados a la mesa. */
  introduccionRellena(): string | null {
    const plantilla = this.plantillaIntroduccion();
    return plantilla && rellenarIntroduccion(plantilla, [...this.asientos.keys()].map((id) => this.personajes.get(id)!.nombre));
  }

  /** Lo que se guarda en la base para poder retomar la partida. */
  estadoGuardable(): EstadoSesion {
    return {
      nodo_actual: this.nodo,
      variables: this.variables(),
      ia_pausada: this.ia?.pausada ?? false,
      ia_perfil_id: this.ia?.perfil.id ?? null,
      introduccion: this.introduccion,
    };
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
    if (this.hashTokenGm === null || token === null) return error('Token de GM incorrecto');
    const dado = Buffer.from(hashToken(token), 'hex');
    const esperado = Buffer.from(this.hashTokenGm, 'hex');
    if (dado.length !== esperado.length || !timingSafeEqual(dado, esperado)) return error('Token de GM incorrecto');
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

  pgDe(personajeId: string): number | undefined {
    return this.pg.get(personajeId);
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
      monstruos: this.monstruosVisibles().map(monstruoPublico),
      mapa: this.mapa && vistaJugadores(this.mapa, (id) => this.monstruo(id) !== undefined),
      que_sigue: this.queSigue(),
    };
  }

  cargarMapa(mapa: Mapa | null) {
    this.mapa = mapa;
  }

  /** El mapa con todo (para el GM y para guardar). */
  mapaCompleto(): Mapa | null {
    return this.mapa;
  }

  configurarMapa(ancho: number, alto: number, velocidad: number): Resultado {
    const m = crearMapa(ancho, alto, velocidad, this.mapa);
    if (typeof m === 'string') return error(m);
    this.mapa = m;
    return ok;
  }

  fondoMapa(url: string | null): Resultado {
    if (!this.mapa) return error('Primero crea el mapa');
    this.mapa = { ...this.mapa, fondo_url: url };
    return ok;
  }

  /** Mueve (o coloca) una ficha. Solo personajes de la sala o monstruos del encuentro. */
  moverEnMapa(id: string, destino: Posicion, esGm: boolean): Resultado {
    if (!this.mapa) return error('No hay mapa en esta sala');
    if (!this.asientos.has(id) && !this.monstruo(id)) return error('Esa ficha no está en la mesa');
    const motivo = validarMovimiento(this.mapa, id, destino, esGm);
    if (motivo) return error(motivo);
    this.mapa = moverFicha(this.mapa, id, destino);
    return ok;
  }

  niebla(celdas: Posicion[], oculta: boolean): Resultado {
    if (!this.mapa) return error('No hay mapa en esta sala');
    this.mapa = cambiarNiebla(this.mapa, celdas, oculta);
    return ok;
  }

  /** Monstruos que los jugadores pueden ver: los que no están en una casilla bajo la niebla. */
  private monstruosVisibles(): Monstruo[] {
    const mapa = this.mapa;
    if (!mapa) return this.monstruos;
    return this.monstruos.filter((m) => {
      const p = mapa.fichas[m.id];
      return !p || !mapa.ocultas.includes(p.y * mapa.ancho + p.x);
    });
  }

  /** Restaura los monstruos guardados (servidor reiniciado). */
  cargarMonstruos(monstruos: Monstruo[]) {
    this.monstruos = monstruos.map((m) => ({ ...m }));
    const numeros = monstruos.map((m) => Number(m.id.slice(1))).filter(Number.isFinite);
    this.proximoMonstruo = Math.max(0, ...numeros) + 1;
  }

  listaMonstruos(): Monstruo[] {
    return this.monstruos.map((m) => ({ ...m }));
  }

  monstruo(id: string): Monstruo | undefined {
    return this.monstruos.find((m) => m.id === id);
  }

  /** Saca `cantidad` monstruos de la plantilla, numerados ("Kobold 1", "Kobold 2"…). Máx. 6 vivos. */
  agregarMonstruos(p: Plantilla & { imagen_url?: string | null }, cantidad: number): { ok: true; nuevos: Monstruo[] } | { ok: false; error: string } {
    const vivos = this.monstruos.filter((m) => m.pg_actual > 0).length;
    if (vivos + cantidad > MAX_MONSTRUOS_VIVOS) return { ok: false, error: `Máximo ${MAX_MONSTRUOS_VIVOS} monstruos vivos a la vez (ya hay ${vivos})` };
    const usados = this.monstruos.filter((m) => m.nombre.startsWith(`${p.nombre} `)).map((m) => Number(m.nombre.slice(p.nombre.length + 1)) || 0);
    let n = Math.max(0, ...usados);
    const nuevos = Array.from({ length: cantidad }, (): Monstruo => ({
      id: `m${this.proximoMonstruo++}`,
      nombre: `${p.nombre} ${++n}`,
      srd_clave: p.srd_clave,
      ca: p.ca,
      pg_max: p.pg,
      pg_actual: p.pg,
      ataques: p.ataques,
      imagen_url: p.imagen_url ?? null,
    }));
    this.monstruos = [...this.monstruos, ...nuevos];
    return { ok: true, nuevos };
  }

  quitarMonstruo(id: string): Resultado {
    if (!this.monstruo(id)) return error('Ese monstruo no está en la mesa');
    this.monstruos = this.monstruos.filter((m) => m.id !== id);
    if (this.mapa) this.mapa = quitarFicha(this.mapa, id);
    return ok;
  }

  /** Suma o resta PG a un monstruo entre 0 y su máximo. Devuelve el cambio real. */
  pgMonstruo(id: string, cantidad: number): { ok: true; monstruo: Monstruo; delta: number } | { ok: false; error: string } {
    const m = this.monstruo(id);
    if (!m) return { ok: false, error: 'Ese monstruo no está en la mesa' };
    const pg = Math.max(0, Math.min(m.pg_max, m.pg_actual + cantidad));
    const actualizado = { ...m, pg_actual: pg };
    this.monstruos = this.monstruos.map((x) => (x.id === id ? actualizado : x));
    return { ok: true, monstruo: actualizado, delta: pg - m.pg_actual };
  }

  /**
   * Apunta algo que se resolvió después de una intervención de la IA (p. ej. el daño de la tirada que pidió).
   * Si la IA va a narrarlo, va a esa próxima intervención; si no, a la última.
   */
  anotarIntervencion(extra: Partial<IntervencionIa>, enLaProxima: boolean) {
    if (!this.ia) return;
    this.ia = enLaProxima
      ? { ...this.ia, arrastre: unirIntervenciones(this.ia.arrastre, extra) }
      : { ...this.ia, ultima: unirIntervenciones(this.ia.ultima, extra) };
  }

  /** Qué toca ahora, en orden de prioridad: tirada pendiente, IA, turno de un jugador o el GM. */
  queSigue(): string {
    for (const [id, p] of this.peticiones) {
      return `Esperando la tirada de ${this.personajes.get(id)?.nombre ?? '?'}: ${p.motivo ?? p.notacion}`;
    }
    if (this.ia && this.ia_pensando) return 'IA pensando…';
    if (this.ia?.pausada) return 'IA pausada: el GM humano decide';
    const turno = this.turnoDe();
    if (turno) return `Turno de ${this.personajes.get(turno)?.nombre ?? '?'}: escribe tu acción`;
    return 'Turno del GM';
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
