// Conecta el GM IA con una sala: disparadores, pausa, deshacer y panel del GM humano.
import { buscarNodo, salidas } from '../rules/aventura.ts';
import { esChequeo } from '../rules/habilidades.ts';
import type { GmIa } from '../ia/gm-ia.ts';
import type { EstadoGasto } from '../ia/presupuesto.ts';
import type { AlmacenPerfiles } from '../ia/perfiles.ts';
import type { Evento, Repositorio, TipoEvento } from './repositorio.ts';
import { intervencionVacia, SIN_INTERVENCION, unirIntervenciones, type IntervencionIa, type Sala } from './sala.ts';
import type { Monstruo } from '../rules/monstruos.ts';
import type { Objetivo } from '../ia/gm-ia.ts';

const AUTOR_IA = 'gm_ia';
const EVENTOS_CONTEXTO = 40; // la IA usa los últimos 20 de juego y 8 de chat
export const TIEMPO_MAXIMO_MS = 45_000; // pasado esto se libera la sala aunque la API no conteste

/** Lo que la mesa necesita del gestor. */
export interface Puertos {
  repo: Repositorio;
  publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>): Promise<Evento | { id: null }>;
  pedirTirada(
    sala: Sala, autor: string, personajeId: string, tirada: { chequeo?: string; notacion?: string }, motivo: string | null, cd: number | null,
    objetivo?: Objetivo,
  ): Promise<void>;
  agregarMonstruos(sala: Sala, autor: string, srdClave: string, cantidad: number, extra: Record<string, unknown>): Promise<{ evento: Evento | { id: null }; nuevos: Monstruo[] }>;
  criaturas(sala: Sala): Promise<{ srd_clave: string; nombre: string }[]>;
  registro(mensaje: string, err?: unknown): void;
  guardarEstado(sala: Sala): Promise<void>;
  /** Aplica PG y publica el evento. Devuelve el cambio real (tras recortar a 0 y al máximo). */
  aplicarPg(sala: Sala, autor: string, personajeId: string, cantidad: number, extra: Record<string, unknown>): Promise<{ evento: Evento | { id: null }; delta: number }>;
}

const AVISOS: Record<EstadoGasto['nivel'], (e: EstadoGasto) => string> = {
  ok: () => '',
  aviso: (e) => `Aviso: la IA ya gastó $${e.gastado.toFixed(2)} de $${e.tope.toFixed(2)} este mes (80 %).`,
  agotado: () => 'Tope de IA alcanzado: el GM humano toma el control.',
};

export class MesaIa {
  private readonly gm: GmIa | null;
  readonly perfiles: AlmacenPerfiles;
  private readonly puertos: Puertos;
  private readonly enCurso = new WeakMap<Sala, Promise<void>>(); // una intervención a la vez por sala
  private readonly paneles = new WeakMap<Sala, Promise<void>>();

  private readonly tiempoMaximo: number;

  constructor(gm: GmIa | null, perfiles: AlmacenPerfiles, puertos: Puertos, tiempoMaximo = TIEMPO_MAXIMO_MS) {
    this.tiempoMaximo = tiempoMaximo;
    this.gm = gm;
    this.perfiles = perfiles;
    this.puertos = puertos;
  }

  disponible() {
    return this.gm !== null;
  }

  /** Activa el GM IA en la sala con ese perfil. Devuelve un error de uso o null. */
  async activar(sala: Sala, perfilId: string): Promise<string | null> {
    if (!this.gm) return 'La IA está desactivada: falta ANTHROPIC_API_KEY en el servidor';
    const perfil = await this.perfiles.buscar(perfilId);
    if (!perfil) return 'No existe ese perfil de GM';
    sala.ia = { perfil, pausada: false, puede_pg: true, ultima: SIN_INTERVENCION, arrastre: SIN_INTERVENCION };
    return null;
  }

  /** Texto fijo de bienvenida (sin llamar a la API). */
  static bienvenida(perfil: { nombre: string; descripcion: string }) {
    return `Esta mesa la dirige ${perfil.nombre} (GM IA): ${perfil.descripcion}
Cómo se juega:
1) En tu turno escribe qué hace tu personaje, en texto libre.
2) Cuando el GM pida una tirada te aparecerá un botón para tirar; no puedes tirar por tu cuenta.
3) Fuera de turno puedes hablar con el grupo en el chat de mesa.
4) El GM humano puede intervenir o pausar la IA en cualquier momento.
El GM IA puede equivocarse: si algo no te cuadra, díselo en el chat.`;
  }

  /** ¿Respondería la IA a un disparador ahora mismo? */
  responderia(sala: Sala) {
    return Boolean(this.gm && sala.ia && !sala.ia.pausada && !this.enCurso.has(sala));
  }

  /** Lanza una intervención de la IA sin bloquear la sala. */
  disparar(sala: Sala, disparador: string) {
    const ia = sala.ia;
    if (!this.gm || !ia || ia.pausada) return;
    if (this.enCurso.has(sala)) {
      sala.enviarGm({ tipo: 'error', mensaje: 'La IA todavía está respondiendo; espera un momento' });
      return;
    }
    // La promesa vive aquí y no en sala.ia: ese objeto se reemplaza por copias y el bloqueo quedaba colgado.
    let reloj: NodeJS.Timeout | undefined;
    const limite = new Promise<void>((listo) => {
      reloj = setTimeout(() => {
        sala.enviarGm({ tipo: 'error', mensaje: 'La IA no respondió en 45 s; sigue tú o vuelve a intentarlo' });
        listo();
      }, this.tiempoMaximo);
    });
    const intervencion = Promise.race([this.intervenir(sala, disparador), limite]).finally(() => {
      clearTimeout(reloj);
      this.enCurso.delete(sala);
      this.marcarPensando(sala, false);
      void this.enviarPanel(sala);
    });
    this.enCurso.set(sala, intervencion);
    this.marcarPensando(sala, true);
  }

  /** Actualiza la franja "Qué sigue" de todos. */
  private marcarPensando(sala: Sala, pensando: boolean) {
    sala.ia_pensando = pensando;
    sala.difundir({ tipo: 'estado', estado: sala.estado() });
  }

  /** Para tests y apagado: espera a que termine la intervención en curso. */
  async esperar(sala: Sala) {
    await this.enCurso.get(sala);
    await this.paneles.get(sala);
  }

  permitirPg(sala: Sala, permitido: boolean) {
    if (!sala.ia) return 'Esta sala no tiene GM IA';
    sala.ia = { ...sala.ia, puede_pg: permitido };
    return null;
  }

  pausar(sala: Sala, pausada: boolean) {
    if (!sala.ia) return 'Esta sala no tiene GM IA';
    sala.ia = { ...sala.ia, pausada };
    return null;
  }

  /** Lo que hizo la última intervención: el gestor oculta sus eventos y revierte sus PG. */
  deshacer(sala: Sala): IntervencionIa {
    const ultima = sala.ia?.ultima ?? SIN_INTERVENCION;
    if (sala.ia) sala.ia = { ...sala.ia, ultima: SIN_INTERVENCION };
    return ultima;
  }

  private async intervenir(sala: Sala, disparador: string) {
    const gm = this.gm!;
    const perfil = sala.ia!.perfil;
    const firma = `GM IA · ${perfil.nombre}`;
    const ids: number[] = [];
    const cambiosPg: IntervencionIa['pg'] = [];
    const agregados: string[] = [];
    const anotar = (e: Evento | { id: null }) => {
      if (e.id !== null) ids.push(e.id);
    };
    try {
      await gm.turno(
        async () => ({
          perfil,
          campana: { nombre: sala.campana.nombre, resumen: sala.campana.resumen ?? '', diagrama: sala.diagrama },
          nodo_actual: sala.nodoActual(),
          variables: sala.variables(),
          jugadores: sala.estado().jugadores,
          eventos: await this.puertos.repo.ultimosEventos(sala.sesion.id, EVENTOS_CONTEXTO),
          permitir_pg: sala.ia?.puede_pg ?? false,
          monstruos: sala.listaMonstruos(),
          criaturas: await this.puertos.criaturas(sala),
        }),
        disparador,
        {
          narrar: (texto) => sala.encolar(async () => {
            anotar(await this.puertos.publicar(sala, 'mensaje', AUTOR_IA, { texto, personaje_nombre: firma, ia: true }));
            return 'Narración publicada';
          }),
          pedirTirada: (personajeId, tirada, cd, motivo, objetivo) => sala.encolar(async () => {
            try {
              await this.puertos.pedirTirada(sala, AUTOR_IA, personajeId, esChequeo(tirada) ? { chequeo: tirada } : { notacion: tirada }, motivo, cd, objetivo);
            } catch (err) {
              return `No se pudo pedir la tirada: ${(err as Error).message}`;
            }
            return 'Tirada pedida. Espera el resultado: llegará como un nuevo evento.';
          }),
          avanzarNodo: (nodoId) => sala.encolar(async () => {
            const r = sala.cambiarNodo(nodoId);
            if (!r.ok) return r.error;
            await this.puertos.guardarEstado(sala);
            anotar(await this.puertos.publicar(sala, 'estado', AUTOR_IA, { cambio: 'nodo', nodo_id: nodoId, titulo: buscarNodo(sala.diagrama, nodoId)?.titulo, personaje_nombre: firma, ia: true }));
            return `Ahora en el nodo ${nodoId}`;
          }),
          agregarMonstruos: (srdClave, cantidad) => sala.encolar(async () => {
            try {
              const r = await this.puertos.agregarMonstruos(sala, AUTOR_IA, srdClave, cantidad, { ia: true, firma });
              anotar(r.evento);
              agregados.push(...r.nuevos.map((m) => m.id));
              return `Entran: ${r.nuevos.map((m) => `${m.nombre} (id ${m.id})`).join(', ')}`;
            } catch (err) {
              return `No se pudieron sacar: ${(err as Error).message}`;
            }
          }),
          aplicarPg: (personajeId, cantidad, motivo) => sala.encolar(async () => {
            if (!sala.ia?.puede_pg) return 'El GM humano desactivó que apliques daño o curación';
            const r = await this.puertos.aplicarPg(sala, AUTOR_IA, personajeId, cantidad, { motivo, ia: true, firma });
            anotar(r.evento);
            if (r.delta !== 0) cambiosPg.push({ personaje_id: personajeId, delta: r.delta });
            return `PG cambiados en ${r.delta} (${sala.pgDe(personajeId)} actuales)`;
          }),
          fijarVariable: (nombre, valor) => sala.encolar(async () => {
            const r = sala.fijarVariable(nombre, valor);
            if (!r.ok) return r.error;
            await this.puertos.guardarEstado(sala);
            return `${nombre} = ${JSON.stringify(valor)}`;
          }),
        },
        (nivel, estado) => {
          const texto = AVISOS[nivel](estado);
          if (texto) void sala.encolar(() => this.puertos.publicar(sala, 'estado', 'sistema', { cambio: 'ia_gasto', nivel, texto }));
        },
      );
    } catch (err) {
      this.puertos.registro('[ia] la intervención falló:', err);
      // Mensaje del SDK o de red; nunca incluye la key.
      sala.enviarGm({ tipo: 'error', mensaje: `La IA falló: ${(err as Error).message}`.slice(0, 300) });
    } finally {
      if (sala.ia) {
        const hecho = unirIntervenciones(sala.ia.arrastre, { eventos: ids, pg: cambiosPg, agregados });
        sala.ia = { ...sala.ia, arrastre: SIN_INTERVENCION, ...(!intervencionVacia(hecho) && { ultima: hecho }) };
      }
    }
  }

  /** Estado privado para el GM humano. En cola por sala: cada panel se arma y envía en orden, nunca uno viejo después de uno nuevo. */
  enviarPanel(sala: Sala): Promise<void> {
    const siguiente = (this.paneles.get(sala) ?? Promise.resolve())
      .then(() => this.armarYEnviarPanel(sala))
      .catch((err) => this.puertos.registro('[ia] no se pudo enviar el panel del GM:', err));
    this.paneles.set(sala, siguiente);
    return siguiente;
  }

  private async armarYEnviarPanel(sala: Sala) {
    if (!sala.hayGm()) return;
    const nodo = buscarNodo(sala.diagrama, sala.nodoActual());
    const gasto = this.gm ? await this.gm.estadoGasto() : null;
    sala.enviarGm({
      tipo: 'panel_gm',
      nodo: nodo ? { id: nodo.id, titulo: nodo.titulo, notas: nodo.notas } : null,
      nodos: sala.diagrama.nodos.map(({ id, titulo }) => ({ id, titulo })),
      salidas: salidas(sala.diagrama, sala.nodoActual()),
      variables: sala.variables(),
      ia: sala.ia
        ? { perfil: sala.ia.perfil.nombre, pausada: sala.ia.pausada, pensando: this.enCurso.has(sala), puede_deshacer: !intervencionVacia(sala.ia.ultima), puede_pg: sala.ia.puede_pg }
        : null,
      ia_disponible: this.disponible(),
      gasto,
      avisos: await this.puertos.repo.avisosBase().catch(() => []),
      monstruos: sala.listaMonstruos(), // con PG exactos: solo para el GM
      criaturas: await this.puertos.criaturas(sala).catch(() => []),
    });
  }
}
