// Conecta el GM IA con una sala: disparadores, pausa, deshacer y panel del GM humano.
import { buscarNodo, salidas } from '../rules/aventura.ts';
import { esChequeo } from '../rules/habilidades.ts';
import type { GmIa } from '../ia/gm-ia.ts';
import type { EstadoGasto } from '../ia/presupuesto.ts';
import type { Perfiles } from '../ia/perfiles.ts';
import type { Evento, Repositorio, TipoEvento } from './repositorio.ts';
import type { Sala } from './sala.ts';

const AUTOR_IA = 'gm_ia';
const EVENTOS_CONTEXTO = 20;

/** Lo que la mesa necesita del gestor. */
export interface Puertos {
  repo: Repositorio;
  publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>): Promise<Evento | { id: null }>;
  pedirTirada(sala: Sala, autor: string, personajeId: string, tirada: { chequeo?: string; notacion?: string }, motivo: string | null, cd: number | null): Promise<void>;
  registro(mensaje: string, err?: unknown): void;
}

const AVISOS: Record<EstadoGasto['nivel'], (e: EstadoGasto) => string> = {
  ok: () => '',
  aviso: (e) => `Aviso: la IA ya gastó $${e.gastado.toFixed(2)} de $${e.tope.toFixed(2)} este mes (80 %).`,
  agotado: () => 'Tope de IA alcanzado: el GM humano toma el control.',
};

export class MesaIa {
  private readonly gm: GmIa | null;
  readonly perfiles: Perfiles;
  private readonly puertos: Puertos;

  constructor(gm: GmIa | null, perfiles: Perfiles, puertos: Puertos) {
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
    sala.ia = { perfil, pausada: false, en_curso: null, ultima: [] };
    return null;
  }

  /** Lanza una intervención de la IA sin bloquear la sala. */
  disparar(sala: Sala, disparador: string) {
    const ia = sala.ia;
    if (!this.gm || !ia || ia.pausada) return;
    if (ia.en_curso) {
      sala.enviarGm({ tipo: 'error', mensaje: 'La IA todavía está respondiendo; espera un momento' });
      return;
    }
    ia.en_curso = this.intervenir(sala, disparador).finally(() => {
      ia.en_curso = null;
      void this.enviarPanel(sala);
    });
  }

  /** Para tests y apagado: espera a que termine la intervención en curso. */
  async esperar(sala: Sala) {
    await sala.ia?.en_curso;
  }

  pausar(sala: Sala, pausada: boolean) {
    if (!sala.ia) return 'Esta sala no tiene GM IA';
    sala.ia = { ...sala.ia, pausada };
    return null;
  }

  /** Ids de los eventos de la última intervención, que el cliente oculta. */
  deshacer(sala: Sala): number[] {
    const ids = sala.ia?.ultima ?? [];
    if (sala.ia) sala.ia = { ...sala.ia, ultima: [] };
    return ids;
  }

  private async intervenir(sala: Sala, disparador: string) {
    const gm = this.gm!;
    const perfil = sala.ia!.perfil;
    const firma = `GM IA · ${perfil.nombre}`;
    const ids: number[] = [];
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
        }),
        disparador,
        {
          narrar: (texto) => sala.encolar(async () => {
            anotar(await this.puertos.publicar(sala, 'mensaje', AUTOR_IA, { texto, personaje_nombre: firma, ia: true }));
            return 'Narración publicada';
          }),
          pedirTirada: (personajeId, tirada, cd, motivo) => sala.encolar(async () => {
            try {
              await this.puertos.pedirTirada(sala, AUTOR_IA, personajeId, esChequeo(tirada) ? { chequeo: tirada } : { notacion: tirada }, motivo, cd);
            } catch (err) {
              return `No se pudo pedir la tirada: ${(err as Error).message}`;
            }
            return 'Tirada pedida. Espera el resultado: llegará como un nuevo evento.';
          }),
          avanzarNodo: (nodoId) => sala.encolar(async () => {
            const r = sala.cambiarNodo(nodoId);
            if (!r.ok) return r.error;
            anotar(await this.puertos.publicar(sala, 'estado', AUTOR_IA, { cambio: 'nodo', nodo_id: nodoId, titulo: buscarNodo(sala.diagrama, nodoId)?.titulo, personaje_nombre: firma, ia: true }));
            return `Ahora en el nodo ${nodoId}`;
          }),
          fijarVariable: (nombre, valor) => sala.encolar(async () => {
            const r = sala.fijarVariable(nombre, valor);
            return r.ok ? `${nombre} = ${JSON.stringify(valor)}` : r.error;
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
      if (sala.ia && ids.length) sala.ia = { ...sala.ia, ultima: ids };
    }
  }

  /** Estado privado para el GM humano: nodo, salidas, variables y gasto de IA. */
  async enviarPanel(sala: Sala) {
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
        ? { perfil: sala.ia.perfil.nombre, pausada: sala.ia.pausada, pensando: sala.ia.en_curso !== null, puede_deshacer: sala.ia.ultima.length > 0 }
        : null,
      ia_disponible: this.disponible(),
      gasto,
    });
  }
}
