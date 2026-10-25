import { randomBytes } from 'node:crypto';
import { roll } from '../rules/dice.ts';
import { tiradaDeChequeo } from '../rules/habilidades.ts';
import { motivoPorDefecto, textoPeticion, textoTirada } from '../rules/tiradas.ts';
import { generarCodigo } from './codigo.ts';
import { validarMensaje, type MensajeCliente } from './protocolo.ts';
import type { Repositorio, TipoEvento } from './repositorio.ts';
import { Sala, type Cliente, type Rol } from './sala.ts';
import { MesaIa } from './mesa-ia.ts';
import { hashToken, intervencionVacia } from './sala.ts';
import { unirCriaturas, type Plantilla } from '../rules/monstruos.ts';
import type { Objetivo } from '../ia/gm-ia.ts';
import type { GmIa } from '../ia/gm-ia.ts';
import type { AlmacenPerfiles } from '../ia/perfiles.ts';

const INTENTOS_CODIGO = 10;
const LARGO_HISTORIAL = 50;
const CHAT_INTERVALO_MS = 1000; // 1 mensaje por segundo por persona

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
  private readonly ultimoChat = new WeakMap<Cliente, number>();
  private readonly criaturas = new Map<string, Promise<Plantilla[]>>(); // por campaña

  constructor(repo: Repositorio, registro: Registro = (m, e) => console.error(m, e ?? ''), ia?: OpcionesIa) {
    this.repo = repo;
    this.registro = registro;
    this.ia = ia
      ? new MesaIa(ia.gm, ia.perfiles, {
          repo,
          registro,
          publicar: (sala, tipo, autor, datos) => this.publicar(sala, tipo, autor, datos),
          pedirTirada: (sala, autor, id, tirada, motivo, cd, objetivo) => this.pedirTirada(sala, autor, id, tirada, motivo, cd, objetivo),
          agregarMonstruos: (sala, autor, clave, n, extra) => this.agregarMonstruos(sala, autor, clave, n, extra),
          criaturas: async (sala) => (await this.plantillas(sala)).map(({ srd_clave, nombre }) => ({ srd_clave, nombre })),
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
      const sala = new Sala(sesion, campana, personajes, hashToken(token));
      sala.sentarGm(cliente, token);
      await this.repo.guardarTokenGm(sesion.id, hashToken(token)).catch((err) => this.registro('[sala] no se pudo guardar el token del GM:', err));
      if (perfilId) {
        await this.ia!.activar(sala, perfilId);
        await this.guardarEstado(sala);
      }
      this.salas.set(sesion.codigo, sala);
      cliente.enviar({ tipo: 'sesion_creada', codigo: sesion.codigo, token_gm: token, estado: sala.estado() });
      // Bienvenida una sola vez por sesión: queda en el historial para quien entre después.
      if (sala.ia) await this.publicar(sala, 'sistema', 'sistema', { cambio: 'bienvenida_ia', texto: MesaIa.bienvenida(sala.ia.perfil) });
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
    const sala = new Sala(sesion, campana, personajes, sesion.gm_token_hash ?? null); // sin migración 002 no hay hash: el GM no puede volver
    sala.cargarMonstruos(await this.repo.monstruosDeSesion(sesion.id));
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
        // Así la franja "Qué sigue" pasa directo a "IA pensando…" sin un parpadeo intermedio.
        if (this.ia?.responderia(sala)) sala.ia_pensando = true;
        await this.publicar(sala, 'accion', autor, { texto: m.texto, personaje_nombre: nombre });
        return this.ia?.disparar(sala, `${nombre} (jugador) hace: ${m.texto}`);
      case 'chat': {
        // Charla entre jugadores: no gasta turno y no despierta a la IA.
        const ahora = Date.now();
        if (ahora - (this.ultimoChat.get(cliente) ?? -Infinity) < CHAT_INTERVALO_MS) throw new ErrorDeJuego('Espera un segundo entre mensajes de chat');
        this.ultimoChat.set(cliente, ahora);
        await this.publicar(sala, 'chat', autor, { texto: m.texto, en_personaje: m.en_personaje, personaje_nombre: nombre });
        return;
      }
      case 'narracion':
        soloGm(quien);
        return this.publicar(sala, 'mensaje', autor, { texto: m.texto, personaje_nombre: nombre });
      case 'tirar': {
        if (quien.rol === 'gm') {
          const r = tirar(m.notacion);
          return this.publicar(sala, 'tirada', autor, { ...r, motivo: m.motivo ?? null, personaje_nombre: nombre, texto: textoTirada(nombre, r, m.motivo ?? null, null) });
        }
        const peticion = sala.tomarPeticion(quien.personaje_id);
        if (!peticion) throw new ErrorDeJuego('No tienes ninguna tirada pendiente: espera a que el GM te pida una');
        const r = tirar(peticion.notacion);
        const exito = peticion.cd === null ? null : r.total >= peticion.cd;
        if (this.ia?.responderia(sala)) sala.ia_pensando = true;
        await this.publicar(sala, 'tirada', autor, { ...r, motivo: peticion.motivo, exito, personaje_nombre: nombre, texto: textoTirada(nombre, r, peticion.motivo, exito) });
        const objetivo = peticion.objetivo_monstruo ? sala.monstruo(peticion.objetivo_monstruo) : undefined;
        const resultado = exito === null ? '' : peticion.efecto === 'ataque' && objetivo
          ? ` contra la CA de ${objetivo.nombre}: ${exito ? 'ACIERTA' : 'FALLA'}`
          : ` contra CD ${peticion.cd}: ${exito ? 'ÉXITO' : 'FRACASO'}`;
        const dano = peticion.efecto === 'daño' && objetivo ? await this.danarMonstruo(sala, objetivo.id, r.total, peticion.de_ia === true) : '';
        return this.ia?.disparar(sala, `${nombre} tiró ${peticion.motivo ?? peticion.notacion} (${r.notation}) y sacó ${r.total}${resultado}.${dano ? ` ${dano}` : ''}`);
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
        if (!ultima || intervencionVacia(ultima)) throw new ErrorDeJuego('No hay ninguna intervención de la IA para deshacer');
        for (const { personaje_id, delta } of [...ultima.pg].reverse()) {
          const r = sala.aplicarPg(personaje_id, -delta);
          if (r.ok) await this.guardarPg(personaje_id, r.pg);
        }
        for (const { id, delta } of [...ultima.monstruos].reverse()) sala.pgMonstruo(id, -delta);
        for (const id of ultima.agregados) sala.quitarMonstruo(id);
        if (ultima.monstruos.length || ultima.agregados.length) await this.guardarMonstruos(sala);
        return this.publicar(sala, 'estado', autor, {
          cambio: 'deshacer_ia',
          eventos: ultima.eventos,
          texto: `El GM deshizo la última intervención de la IA${ultima.pg.length ? ' (PG restaurados)' : ''}.`,
        });
      }
      case 'agregar_monstruos':
        soloGm(quien);
        await this.agregarMonstruos(sala, autor, m.srd_clave, m.cantidad, {});
        return;
      case 'quitar_monstruo': {
        soloGm(quien);
        const monstruo = sala.monstruo(m.monstruo_id);
        const r = sala.quitarMonstruo(m.monstruo_id);
        if (!r.ok) throw new ErrorDeJuego(r.error);
        await this.guardarMonstruos(sala);
        return this.publicar(sala, 'estado', autor, { cambio: 'monstruos', texto: `${monstruo!.nombre} sale del encuentro.` });
      }
      case 'monstruo_pg': {
        soloGm(quien);
        if (!sala.monstruo(m.monstruo_id)) throw new ErrorDeJuego('Ese monstruo no está en la mesa');
        if (m.cantidad < 0) return void (await this.danarMonstruo(sala, m.monstruo_id, -m.cantidad, false));
        const r = sala.pgMonstruo(m.monstruo_id, m.cantidad);
        if (!r.ok) throw new ErrorDeJuego(r.error);
        await this.guardarMonstruos(sala);
        return this.publicar(sala, 'estado', autor, { cambio: 'monstruos', texto: `${r.monstruo.nombre} se recupera.` });
      }
      case 'ia_permitir_pg': {
        soloGm(quien);
        const error = this.ia ? this.ia.permitirPg(sala, m.permitido) : 'Esta sala no tiene GM IA';
        if (error) throw new ErrorDeJuego(error);
        return this.ia!.enviarPanel(sala);
      }
      case 'ver_diagrama':
        soloGm(quien); // el diagrama lleva notas secretas
        return cliente.enviar({ tipo: 'diagrama', diagrama: sala.diagrama, nodo_actual: sala.nodoActual(), variables: sala.variables() });
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

  /** Criaturas de la campaña (tabla criaturas) más el SRD local para las que falten. */
  private plantillas(sala: Sala): Promise<Plantilla[]> {
    let p = this.criaturas.get(sala.campana.id);
    if (!p) {
      p = this.repo.criaturasDeCampana(sala.campana.id).then(unirCriaturas);
      p.catch(() => this.criaturas.delete(sala.campana.id)); // reintenta si falló la base
      this.criaturas.set(sala.campana.id, p);
    }
    return p;
  }

  private async agregarMonstruos(sala: Sala, autor: string, clave: string, cantidad: number, extra: Record<string, unknown>) {
    const plantilla = (await this.plantillas(sala)).find((c) => c.srd_clave === clave);
    if (!plantilla) throw new ErrorDeJuego('Esa criatura no está disponible');
    const r = sala.agregarMonstruos(plantilla, cantidad);
    if (!r.ok) throw new ErrorDeJuego(r.error);
    await this.guardarMonstruos(sala);
    const evento = await this.publicar(sala, 'estado', autor, { ...extra, cambio: 'monstruos', texto: `Entran: ${r.nuevos.map((x) => x.nombre).join(', ')}.` });
    return { evento, nuevos: r.nuevos };
  }

  /** Resta PG a un monstruo, lo anuncia y, si la tirada la pidió la IA, lo apunta para deshacer. */
  private async danarMonstruo(sala: Sala, id: string, cantidad: number, deIa: boolean): Promise<string> {
    const r = sala.pgMonstruo(id, -cantidad);
    if (!r.ok) return '';
    await this.guardarMonstruos(sala);
    const cae = r.monstruo.pg_actual === 0;
    const texto = cae ? `${r.monstruo.nombre} cae.` : `${r.monstruo.nombre} recibe ${-r.delta} de daño.`;
    const evento = await this.publicar(sala, 'estado', 'sistema', { cambio: 'monstruos', texto });
    if (deIa) sala.anotarIntervencion({ monstruos: [{ id, delta: r.delta }], eventos: evento.id === null ? [] : [evento.id] }, this.ia?.responderia(sala) ?? false);
    return `${texto} (${r.monstruo.nombre}: ${r.monstruo.pg_actual}/${r.monstruo.pg_max} PG)`;
  }

  private async guardarMonstruos(sala: Sala) {
    try {
      await this.repo.guardarMonstruos(sala.sesion.id, sala.listaMonstruos());
    } catch (err) {
      this.registro('[sala] no se pudieron guardar los monstruos:', err); // la memoria manda
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
    objetivo: Objetivo = { objetivo_monstruo: null, efecto: null },
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
    const proposito = motivo?.trim() || motivoPorDefecto(notacion); // nunca sin propósito
    const monstruo = objetivo.objetivo_monstruo ? sala.monstruo(objetivo.objetivo_monstruo) : undefined;
    if (objetivo.objetivo_monstruo && !monstruo) throw new ErrorDeJuego('Ese monstruo no está en la mesa');
    // Contra un monstruo, la CD del ataque es su CA (secreta para los jugadores).
    const cdFinal = objetivo.efecto === 'ataque' && monstruo ? monstruo.ca : cd;
    const r = sala.pedirTirada(personajeId, {
      notacion, motivo: proposito, cd: cdFinal, objetivo_monstruo: monstruo?.id ?? null, efecto: monstruo ? objetivo.efecto : null, de_ia: autor === 'gm_ia',
    });
    if (!r.ok) throw new ErrorDeJuego(r.error);
    await this.publicar(sala, 'estado', autor, {
      cambio: 'pedir_tirada',
      personaje_id: personajeId,
      personaje_nombre: destino.nombre,
      notacion,
      motivo: proposito,
      texto: textoPeticion(destino.nombre, proposito, notacion, autor === 'gm_ia'),
    });
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
