import { randomBytes } from 'node:crypto';
import { roll } from '../rules/dice.ts';
import { generarCodigo } from './codigo.ts';
import { validarMensaje, type MensajeCliente } from './protocolo.ts';
import type { Repositorio, TipoEvento } from './repositorio.ts';
import { Sala, type Cliente, type Rol } from './sala.ts';

const INTENTOS_CODIGO = 10;
const LARGO_HISTORIAL = 50;

export interface Conexion {
  /** Procesa un mensaje crudo del cliente. La promesa se resuelve cuando ya respondió. */
  recibir(crudo: string): Promise<void>;
  /** El cliente se desconectó. */
  cerrar(): void;
}

type Registro = (mensaje: string, err?: unknown) => void;

/** Error de uso que se le muestra al cliente tal cual. */
class ErrorDeJuego extends Error {}

/** Lleva todas las salas abiertas y enruta los mensajes de cada conexión. */
export class Gestor {
  private readonly salas = new Map<string, Sala>();
  private readonly cargando = new Map<string, Promise<Sala | null>>();
  private readonly repo: Repositorio;
  private readonly registro: Registro;

  constructor(repo: Repositorio, registro: Registro = (m, e) => console.error(m, e ?? '')) {
    this.repo = repo;
    this.registro = registro;
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
        cliente.enviar({ tipo: 'campanas', campanas: await this.repo.listarCampanas() });
        return;
      case 'crear_sesion':
        if (sala) throw new ErrorDeJuego('Ya estás en una sala');
        return this.crearSesion(m.campana_id, cliente);
      case 'ver_personajes': {
        const s = await this.salaPorCodigo(m.codigo);
        cliente.enviar({ tipo: 'personajes', codigo: s.sesion.codigo, campana: s.campana, personajes: s.listaPersonajes() });
        return;
      }
      case 'unirse':
      case 'retomar_gm': {
        if (sala) throw new ErrorDeJuego('Ya estás en una sala');
        const s = await this.salaPorCodigo(m.codigo);
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

  private async crearSesion(campanaId: string, cliente: Cliente): Promise<Sala> {
    const campana = await this.repo.buscarCampana(campanaId);
    if (!campana) throw new ErrorDeJuego('No existe esa campaña');
    const personajes = await this.repo.personajesDeCampana(campana.id);

    for (let i = 0; i < INTENTOS_CODIGO; i++) {
      const sesion = await this.repo.crearSesion(campana.id, generarCodigo());
      if (!sesion) continue; // código ya usado: probamos otro
      const token = randomBytes(16).toString('hex');
      const sala = new Sala(sesion, campana, personajes, token);
      sala.sentarGm(cliente, token);
      this.salas.set(sesion.codigo, sala);
      cliente.enviar({ tipo: 'sesion_creada', codigo: sesion.codigo, token_gm: token, estado: sala.estado() });
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
        return this.publicar(sala, 'accion', autor, { texto: m.texto, personaje_nombre: nombre });
      case 'narracion':
        soloGm(quien);
        return this.publicar(sala, 'mensaje', autor, { texto: m.texto, personaje_nombre: nombre });
      case 'tirar': {
        let r;
        try {
          r = roll(m.notacion);
        } catch (err) {
          throw new ErrorDeJuego((err as Error).message);
        }
        return this.publicar(sala, 'tirada', autor, { ...r, motivo: m.motivo ?? null, personaje_nombre: nombre });
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
  }
}

function soloGm(quien: Rol) {
  if (quien.rol !== 'gm') throw new ErrorDeJuego('Solo el GM puede hacer eso');
}
