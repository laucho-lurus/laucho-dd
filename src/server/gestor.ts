import { randomBytes } from 'node:crypto';
import { roll } from '../rules/dice.ts';
import { tiradaDeChequeo } from '../rules/habilidades.ts';
import { generarCodigo } from './codigo.ts';
import { validarMensaje, type MensajeCliente } from './protocolo.ts';
import type { Repositorio, TipoEvento } from './repositorio.ts';
import { Sala, type Cliente, type Rol } from './sala.ts';
import { MesaIa } from './mesa-ia.ts';
import type { GmIa } from '../ia/gm-ia.ts';
import type { AlmacenPerfiles } from '../ia/perfiles.ts';

const INTENTOS_CODIGO = 10;
const LARGO_HISTORIAL = 50;

export interface Conexion {
  /** Procesa un mensaje crudo del cliente. La promesa se resuelve cuando ya respondió. */
  recibir(crudo: string): Promise<void>;
  /** El cliente se desconectó. */
  cerrar(): void;
}

type Registro = (mensaje: string, err?: unknown) => void;

export interface OpcionesIa {
  gm: GmIa | null; // null: sin API key, la IA queda desactivada
  perfiles: AlmacenPerfiles;
  tiempo_maximo_ms?: number;
}

/** Error de uso que se le muestra al cliente tal cual. */
class ErrorDeJuego extends Error {}

/** Lleva todas las salas abiertas y enruta los mensajes de cada conexión. */
export class Gestor {
  private readonly salas = new Map<string, Sala>();
  private readonly cargando = new Map<string, Promise<Sala | null>>();
  private readonly repo: Repositorio;
  private readonly registro: Registro;

  private readonly ia: MesaIa | null;

  constructor(repo: Repositorio, registro: Registro = (m, e) => console.error(m, e ?? ''), ia?: OpcionesIa) {
    this.repo = repo;
    this.registro = registro;
    this.ia = ia
      ? new MesaIa(ia.gm, ia.perfiles, {
          repo,
          registro,
          publicar: (sala, tipo, autor, datos) => this.publicar(sala, tipo, autor, datos),
          pedirTirada: (sala, autor, id, tirada, motivo, cd) => this.pedirTirada(sala, autor, id, tirada, motivo, cd),
          guardarEstado: (sala) => this.guardarEstado(sala),
          aplicarPg: (sala, autor, id, cantidad, extra) => this.aplicarPg(sala, autor, id, cantidad, extra),
        }, ia.tiempo_maximo_ms)
      : null;
  }

  /** Espera a que termine la intervención de IA en curso en esa sala (tests). */
  async esperarIa(codigo: string) {
    const sala = this.salas.get(codigo);
    if (sala && this.ia) await this.ia.esperar(sala);
  }

  conectar(cliente: Cliente): Conexion {
    let sala: Sala | null = null;
    let cerrada = false;

    const recibir = async (crudo: string) => {
      const v = validarMensaje(crudo);
      if (!v.ok) return cliente.enviar({ tipo: 'error', mensaje: v.error });
      try {
        const nueva = await this.atender(v.mensaje, cliente, sala);
        if (nueva) {
          sala = nueva;
          if (cerrada) cerrar(); // se fue mientras entraba: libera el asiento
        }
      } catch (err) {
        if (err instanceof ErrorDeJuego) return cliente.enviar({ tipo: 'error', mensaje: err.message });
        this.registro(`[sala] error atendiendo "${v.mensaje.tipo}":`, err);
        cliente.enviar({ tipo: 'error', mensaje: 'Error interno del servidor' });
      }
    };

    const cerrar = () => {
      cerrada = true;
      const s = sala;
      if (!s) return;
      sala = null;
      void s.encolar(async () => {
        s.levantar(cliente);
        s.difundir({ tipo: 'estado', estado: s.estado() });
      });
    };

    return { recibir, cerrar };
  }

  /** Devuelve la sala a la que el cliente acaba de entrar, si entró a una. */
  private async atender(m: MensajeCliente, cliente: Cliente, sala: Sala | null): Promise<Sala | void> {
    switch (m.tipo) {
      case 'ver_campanas':
        cliente.enviar({
          tipo: 'campanas',
          campanas: (await this.repo.listarCampanas()).map(({ id, nombre }) => ({ id, nombre })),
          perfiles: this.ia ? (await this.ia.perfiles.listar()).map(({ id, nombre, descripcion }) => ({ id, nombre, descripcion })) : [],
          ia_disponible: this.ia?.disponible() ?? false,
        });
        return;
      case 'crear_sesion':
        if (sala) throw new ErrorDeJuego('Ya estás en una sala');
        return this.crearSesion(m.campana_id, cliente, m.gm_perfil_id);
      case 'ver_personajes': {
        const s = await this.salaPorCodigo(m.codigo);
        s.incorporar(await this.repo.personajesDeCampana(s.campana.id));
        cliente.enviar({ tipo: 'personajes', codigo: s.sesion.codigo, campana: { id: s.campana.id, nombre: s.campana.nombre }, personajes: s.listaPersonajes() });
        return;
      }
      case 'unirse':
      case 'retomar_gm': {
        if (sala) throw new ErrorDeJuego('Ya estás en una sala');
        const s = await this.salaPorCodigo(m.codigo);
        if (m.tipo === 'unirse' && !s.personaje(m.personaje_id)) s.incorporar(await this.repo.personajesDeCampana(s.campana.id));
        await s.encolar(() => (m.tipo === 'unirse' ? this.unirse(s, m.personaje_id, cliente) : this.retomarGm(s, m.token_gm, cliente)));
        return s;
      }
      default: {
        if (!sala) throw new ErrorDeJuego('Primero entra a una sala');
        const s = sala;
        await s.encolar(() => this.enSala(m, s, cliente));
      }
    }
  }

  private async crearSesion(campanaId: string, cliente: Cliente, perfilId?: string): Promise<Sala> {
    const campana = await this.repo.buscarCampana(campanaId);
    if (!campana) throw new ErrorDeJuego('No existe esa campaña');
    if (perfilId && !this.ia) throw new ErrorDeJuego('La IA no está configurada en este servidor');
    if (perfilId && !this.ia!.disponible()) throw new ErrorDeJuego('La IA está desactivada: falta ANTHROPIC_API_KEY en el servidor');
    if (perfilId && !(await this.ia!.perfiles.buscar(perfilId))) throw new ErrorDeJuego('No existe ese perfil de GM');
    const personajes = await this.repo.personajesDeCampana(campana.id);

    for (let i = 0; i < INTENTOS_CODIGO; i++) {
      const sesion = await this.repo.crearSesion(campana.id, generarCodigo());
      if (!sesion) continue; // código ya usado: probamos otro
      const token = randomBytes(16).toString('hex');
      const sala = new Sala(sesion, campana, personajes, token);
      sala.sentarGm(cliente, token);
      if (perfilId) {
        await this.ia!.activar(sala, perfilId);
        await this.guardarEstado(sala);
      }
      this.salas.set(sesion.codigo, sala);
      cliente.enviar({ tipo: 'sesion_creada', codigo: sesion.codigo, token_gm: token, estado: sala.estado() });
      await this.ia?.enviarPanel(sala);
      return sala;
    }
    throw new Error('No se pudo generar un código de sala libre');
  }

  /** Sala abierta en memoria, o la recupera de la base si el servidor se reinició. */
  private async salaPorCodigo(codigo: string): Promise<Sala> {
    const abierta = this.salas.get(codigo);
    if (abierta) return abierta;
    let carga = this.cargando.get(codigo);
    if (!carga) {
      carga = this.cargarSala(codigo).finally(() => this.cargando.delete(codigo));
      this.cargando.set(codigo, carga);
    }
    const sala = await carga;
    if (!sala) throw new ErrorDeJuego('No hay ninguna sala con ese código');
    return sala;
  }

  private async cargarSala(codigo: string): Promise<Sala | null> {
    const sesion = await this.repo.buscarSesionPorCodigo(codigo);
    if (!sesion || sesion.estado === 'cerrada') return null;
    const campana = await this.repo.buscarCampana(sesion.campana_id);
    if (!campana) return null;
    const personajes = await this.repo.personajesDeCampana(campana.id);
    // El token del GM vive solo en memoria: tras un reinicio el GM no puede retomar (ver README).
    const sala = new Sala(sesion, campana, personajes, null);
    if (sesion.ia_perfil_id && this.ia?.disponible()) {
      const error = await this.ia.activar(sala, sesion.ia_perfil_id);
      if (error) this.registro(`[sala] no se pudo retomar el GM IA de ${codigo}: ${error}`);
      else this.ia.pausar(sala, sesion.ia_pausada ?? false);
    }
    this.salas.set(codigo, sala);
    return sala;
  }

  private async unirse(sala: Sala, personajeId: string, cliente: Cliente) {
    const r = sala.sentarJugador(personajeId, cliente);
    if (!r.ok) throw new ErrorDeJuego(r.error);
    const nombre = sala.personaje(personajeId)!.nombre;
    await this.bienvenida(sala, cliente, { rol: 'jugador', personaje_id: personajeId });
    await this.publicar(sala, 'estado', 'sistema', { cambio: 'entra', personaje_id: personajeId, personaje_nombre: nombre });
  }

  private async retomarGm(sala: Sala, token: string, cliente: Cliente) {
    const r = sala.sentarGm(cliente, token);
    if (!r.ok) throw new ErrorDeJuego(r.error);
    await this.bienvenida(sala, cliente, { rol: 'gm' });
    sala.difundir({ tipo: 'estado', estado: sala.estado() });
    await this.ia?.enviarPanel(sala);
  }

  private async bienvenida(sala: Sala, cliente: Cliente, rol: Rol) {
    const historial = await this.repo.ultimosEventos(sala.sesion.id, LARGO_HISTORIAL);
    cliente.enviar({ tipo: 'bienvenida', ...rol, estado: sala.estado(), historial });
  }

  private async enSala(m: MensajeCliente, sala: Sala, cliente: Cliente) {
    const quien = sala.rolDe(cliente);
    if (!quien) throw new ErrorDeJuego('Ya no estás en esta sala');
    const autor = quien.rol === 'gm' ? 'gm' : `personaje:${quien.personaje_id}`;
    const nombre = quien.rol === 'gm' ? 'GM' : sala.personaje(quien.personaje_id)!.nombre;

    switch (m.tipo) {
      case 'estado':
        return cliente.enviar({ tipo: 'estado', estado: sala.estado() });
      case 'accion':
        if (quien.rol !== 'jugador') throw new ErrorDeJuego('El GM narra con "narracion", no con "accion"');
        if (sala.turnoDe() !== quien.personaje_id) throw new ErrorDeJuego('No es tu turno');
        await this.publicar(sala, 'accion', autor, { texto: m.texto, personaje_nombre: nombre });
        return this.ia?.disparar(sala, `${nombre} (jugador) hace: ${m.texto}`);
      case 'narracion':
        soloGm(quien);
        return this.publicar(sala, 'mensaje', autor, { texto: m.texto, personaje_nombre: nombre });
      case 'tirar': {
        if (quien.rol === 'gm') {
          return this.publicar(sala, 'tirada', autor, { ...tirar(m.notacion), motivo: m.motivo ?? null, personaje_nombre: nombre });
        }
        const peticion = sala.tomarPeticion(quien.personaje_id);
        if (!peticion) throw new ErrorDeJuego('No tienes ninguna tirada pendiente: espera a que el GM te pida una');
        const r = tirar(peticion.notacion);
        const exito = peticion.cd === null ? null : r.total >= peticion.cd;
        await this.publicar(sala, 'tirada', autor, { ...r, motivo: peticion.motivo, exito, personaje_nombre: nombre });
        const resultado = exito === null ? '' : exito ? ` contra CD ${peticion.cd}: ÉXITO` : ` contra CD ${peticion.cd}: FRACASO`;
        return this.ia?.disparar(sala, `${nombre} tiró ${peticion.motivo ?? peticion.notacion} (${r.notation}) y sacó ${r.total}${resultado}.`);
      }
      case 'pedir_tirada':
        soloGm(quien);
        return this.pedirTirada(sala, autor, m.personaje_id, m, m.motivo ?? null, m.cd ?? null);
      case 'narrar_escena':
        soloGm(quien);
        if (!sala.ia) throw new ErrorDeJuego('Esta sala no tiene GM IA');
        if (sala.ia.pausada) throw new ErrorDeJuego('La IA está pausada');
        return this.ia!.disparar(sala, 'El GM humano pide que narres la escena actual.');
      case 'pausar_ia': {
        soloGm(quien);
        const error = this.ia ? this.ia.pausar(sala, m.pausada) : 'Esta sala no tiene GM IA';
        if (error) throw new ErrorDeJuego(error);
        await this.guardarEstado(sala);
        return this.publicar(sala, 'estado', autor, { cambio: 'ia_pausa', pausada: m.pausada, texto: m.pausada ? 'El GM pausó la IA.' : 'El GM reanudó la IA.' });
      }
      case 'deshacer_ia': {
        soloGm(quien);
        const ultima = this.ia?.deshacer(sala);
        if (!ultima || ultima.eventos.length + ultima.pg.length === 0) throw new ErrorDeJuego('No hay ninguna intervención de la IA para deshacer');
        for (const { personaje_id, delta } of [...ultima.pg].reverse()) {
          const r = sala.aplicarPg(personaje_id, -delta);
          if (r.ok) await this.guardarPg(personaje_id, r.pg);
        }
        return this.publicar(sala, 'estado', autor, {
          cambio: 'deshacer_ia',
          eventos: ultima.eventos,
          texto: `El GM deshizo la última intervención de la IA${ultima.pg.length ? ' (PG restaurados)' : ''}.`,
        });
      }
      case 'ia_permitir_pg': {
        soloGm(quien);
        const error = this.ia ? this.ia.permitirPg(sala, m.permitido) : 'Esta sala no tiene GM IA';
        if (error) throw new ErrorDeJuego(error);
        return this.ia!.enviarPanel(sala);
      }
      case 'cambiar_nodo': {
        soloGm(quien);
        const r = sala.cambiarNodo(m.nodo_id);
        if (!r.ok) throw new ErrorDeJuego(r.error);
        await this.guardarEstado(sala);
        return this.publicar(sala, 'estado', autor, { cambio: 'nodo', nodo_id: m.nodo_id });
      }
      case 'aplicar_pg': {
        soloGm(quien);
        await this.aplicarPg(sala, autor, m.personaje_id, m.cantidad, {});
        return;
      }
      case 'definir_orden': {
        soloGm(quien);
        const r = sala.definirOrden(m.orden);
        if (!r.ok) throw new ErrorDeJuego(r.error);
        return this.publicar(sala, 'estado', autor, { cambio: 'orden', orden: m.orden });
      }
      case 'siguiente_turno': {
        soloGm(quien);
        const r = sala.siguienteTurno();
        if (!r.ok) throw new ErrorDeJuego(r.error);
        return this.publicar(sala, 'estado', autor, { cambio: 'turno', turno_de: sala.turnoDe(), ronda: sala.estado().ronda });
      }
      default:
        throw new ErrorDeJuego('Ya estás en una sala');
    }
  }

  /** Aplica daño/curación (GM humano o IA), guarda los PG y publica el evento. */
  private async aplicarPg(sala: Sala, autor: string, personajeId: string, cantidad: number, extra: Record<string, unknown>) {
    const antes = sala.pgDe(personajeId);
    const r = sala.aplicarPg(personajeId, cantidad);
    if (!r.ok || antes === undefined) throw new ErrorDeJuego(r.ok ? 'Ese personaje no está en la sala' : r.error);
    await this.guardarPg(personajeId, r.pg);
    const evento = await this.publicar(sala, 'estado', autor, {
      ...extra,
      cambio: 'pg',
      personaje_id: personajeId,
      personaje_nombre: sala.personaje(personajeId)!.nombre,
      cantidad,
      pg_actual: r.pg,
      inconsciente: r.pg === 0,
    });
    return { evento, delta: r.pg - antes };
  }

  /** Deja pendiente una tirada para un jugador (GM humano o IA). */
  private async pedirTirada(
    sala: Sala, autor: string, personajeId: string, tirada: { chequeo?: string; notacion?: string }, motivoPedido: string | null, cd: number | null,
  ) {
    const destino = sala.personaje(personajeId);
    if (!destino) throw new ErrorDeJuego('Ese personaje no está en la sala');
    let notacion = tirada.notacion ?? '';
    let motivo = motivoPedido;
    if (tirada.chequeo) {
      const t = tiradaDeChequeo(tirada.chequeo, destino.caracteristicas);
      if (!t) throw new ErrorDeJuego('Habilidad o salvación desconocida');
      notacion = t.notacion;
      motivo = t.motivo;
    }
    tirar(notacion); // valida la notación antes de dejarla pendiente
    const r = sala.pedirTirada(personajeId, { notacion, motivo, cd });
    if (!r.ok) throw new ErrorDeJuego(r.error);
    await this.publicar(sala, 'estado', autor, { cambio: 'pedir_tirada', personaje_id: personajeId, personaje_nombre: destino.nombre, notacion, motivo });
  }

  private async guardarEstado(sala: Sala) {
    try {
      await this.repo.guardarEstadoSesion(sala.sesion.id, sala.estadoGuardable());
    } catch (err) {
      this.registro('[sala] no se pudo guardar el estado de la sesión:', err); // la memoria manda
    }
  }

  private async guardarPg(personajeId: string, pg: number) {
    try {
      await this.repo.guardarPg(personajeId, pg);
    } catch (err) {
      this.registro('[sala] no se pudieron guardar los PG:', err); // la memoria manda, como con los eventos
    }
  }

  /** Guarda el evento y lo retransmite a toda la sala junto con el estado actual. */
  private async publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>) {
    const nuevo = { sesion_id: sala.sesion.id, tipo, autor, datos };
    let evento;
    try {
      evento = await this.repo.registrarEvento(nuevo);
    } catch (err) {
      // La partida sigue: la memoria manda y la base es el registro.
      this.registro('[sala] no se pudo guardar el evento:', err);
      evento = { ...nuevo, id: null, creado_en: new Date().toISOString() };
    }
    sala.difundir({ tipo: 'evento', evento, estado: sala.estado() });
    await this.ia?.enviarPanel(sala);
    return evento;
  }
}

function tirar(notacion: string) {
  try {
    return roll(notacion);
  } catch (err) {
    throw new ErrorDeJuego((err as Error).message);
  }
}

function soloGm(quien: Rol) {
  if (quien.rol !== 'gm') throw new ErrorDeJuego('Solo el GM puede hacer eso');
}
