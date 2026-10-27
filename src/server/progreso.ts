// Hechizos, maná y experiencia en la sala: lanzar (validado y tirado en el servidor), dar XP, subir de nivel y descansos.
import { roll, type RollResult } from '../rules/dice.ts';
import { HECHIZOS } from '../rules/hechizos.ts';
import { ajustarPm, conMagia, descansarPm, gastarPm, leerMagia, pmMax, resolverHechizo } from '../rules/magia.ts';
import { repartirXp, sumarXp } from '../rules/experiencia.ts';
import type { DatosPersonaje, Evento, Personaje, Repositorio, TipoEvento } from './repositorio.ts';
import type { Sala } from './sala.ts';

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

export interface PuertosProgreso {
  repo: Repositorio;
  publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>): Promise<Evento | { id: null }>;
  /** Cambia personajes.datos de un personaje sentado, lo guarda y lo deja en la sala. Lanza ErrorDeJuego si `fn` falla. */
  cambiarDatos<T extends { datos: DatosPersonaje }>(sala: Sala, personajeId: string, fn: (datos: DatosPersonaje, pj: Personaje) => Res<T>): Promise<{ nombre: string; extra: T }>;
  aplicarPg(sala: Sala, autor: string, personajeId: string, cantidad: number, extra: Record<string, unknown>): Promise<unknown>;
  danarMonstruo(sala: Sala, id: string, cantidad: number, deIa: boolean): Promise<string>;
  guardarPg(personajeId: string, pg: number): Promise<void>;
  registro(mensaje: string, err?: unknown): void;
  error(mensaje: string): Error;
  tirar?: (notacion: string) => RollResult;
}

export interface PedidoLanzar {
  hechizo_id: string;
  objetivo_monstruo?: string;
  objetivo_personaje?: string;
}


export class Progreso {
  private readonly p: PuertosProgreso;

  constructor(puertos: PuertosProgreso) {
    this.p = puertos;
  }

  /** Lanza un hechizo conocido: valida turno, objetivo y PM; tira, aplica y anuncia. Devuelve el resumen para la IA. */
  async lanzar(sala: Sala, autor: string, personajeId: string, pedido: PedidoLanzar): Promise<string> {
    if (sala.turnoDe() !== personajeId) throw this.p.error('No es tu turno');
    const h = HECHIZOS[pedido.hechizo_id];
    if (!h) throw this.p.error('Ese hechizo no existe');
    const monstruo = pedido.objetivo_monstruo ? sala.monstruo(pedido.objetivo_monstruo) : undefined;
    if (pedido.objetivo_monstruo && (!monstruo || monstruo.pg_actual <= 0)) throw this.p.error('Ese objetivo no está en pie');
    const curar = h.efecto.tipo === 'curacion';
    const aliado = curar ? pedido.objetivo_personaje ?? personajeId : undefined;
    if (aliado && !sala.estado().jugadores.some((j) => j.personaje_id === aliado)) throw this.p.error('Ese personaje no está en la mesa');

    const r = await this.p.cambiarDatos(sala, personajeId, (datos, pj) => {
      const g = gastarPm(leerMagia(datos), pmMax(pj.clase, pj.nivel, pj.caracteristicas), h.id);
      return g.ok ? { ok: true, valor: { datos: conMagia(datos, g.valor.magia), costo: g.valor.costo, pj } } : g;
    });
    const { pj, costo } = r.extra;
    const resultado = resolverHechizo(h, { car: pj.caracteristicas, nivel: pj.nivel, clase: pj.clase }, monstruo ? { ca: monstruo.ca } : null, this.p.tirar ?? roll);
    const sobre = monstruo ? ` sobre ${monstruo.nombre}` : aliado && aliado !== personajeId ? ` sobre ${sala.personaje(aliado)!.nombre}` : '';
    const texto = `${r.nombre} lanza ${h.nombre}${costo ? ` (−${costo} PM)` : ''}${sobre}: ${resultado.texto}.`;
    await this.p.publicar(sala, 'estado', autor, { cambio: 'hechizo', hechizo_id: h.id, texto });
    if (monstruo && resultado.dano > 0) await this.p.danarMonstruo(sala, monstruo.id, resultado.dano, false);
    if (aliado && resultado.curacion > 0) {
      const falta = sala.personaje(aliado)!.pg_max - (sala.pgDe(aliado) ?? 0);
      await this.p.aplicarPg(sala, autor, aliado, Math.min(resultado.curacion, falta), { motivo: h.nombre });
    }
    return texto;
  }

  /** El GM suma o resta PM a un personaje. */
  async ajustarPm(sala: Sala, autor: string, personajeId: string, cantidad: number) {
    const r = await this.p.cambiarDatos(sala, personajeId, (datos, pj) => {
      const max = pmMax(pj.clase, pj.nivel, pj.caracteristicas);
      if (!max) return { ok: false, error: `${pj.nombre} no lanza hechizos` };
      const magia = ajustarPm(leerMagia(datos), max, cantidad);
      return { ok: true, valor: { datos: conMagia(datos, magia), pm: magia.pm, max } };
    });
    await this.p.publicar(sala, 'estado', autor, { cambio: 'pm', texto: `${r.nombre}: ${r.extra.pm}/${r.extra.max} PM.` });
  }

  /** Recupera PM en un descanso. Devuelve "Ilyra +3 PM" o null si no recupera nada. */
  async descansar(sala: Sala, personajeId: string, tipo: 'corto' | 'largo', corto: boolean): Promise<string | null> {
    const r = await this.p.cambiarDatos(sala, personajeId, (datos, pj) => {
      const max = pmMax(pj.clase, pj.nivel, pj.caracteristicas);
      const d = descansarPm(leerMagia(datos), max, tipo, corto);
      return { ok: true, valor: { datos: max ? conMagia(datos, d.magia) : datos, recuperados: max ? d.recuperados : 0 } };
    });
    return r.extra.recuperados ? `${r.nombre} +${r.extra.recuperados} PM` : null;
  }

  /** Suma XP, sube de nivel si toca (columnas nivel y pg_max) y lo anuncia. */
  async darXp(sala: Sala, autor: string, personajeId: string, cantidad: number, extra: Record<string, unknown> = {}) {
    const r = await this.p.cambiarDatos(sala, personajeId, (datos, pj) => {
      const s = sumarXp(pj.clase, pj.caracteristicas, pj.nivel, typeof datos.xp === 'number' ? datos.xp : 0, cantidad);
      return { ok: true, valor: { datos: { ...datos, xp: s.xp }, subida: s, antes: pj.nivel } };
    });
    const { subida, antes } = r.extra;
    const signo = cantidad >= 0 ? `gana ${cantidad}` : `pierde ${-cantidad}`;
    let texto = `${r.nombre} ${signo} XP (${subida.xp} en total).`;
    if (subida.nivel > antes) {
      sala.subirNivel(personajeId, subida.nivel, subida.pg_extra);
      const pj = sala.personaje(personajeId)!;
      try {
        await this.p.repo.guardarNivel(personajeId, subida.nivel, pj.pg_max);
        await this.p.guardarPg(personajeId, sala.pgDe(personajeId)!);
      } catch (err) {
        this.p.registro('[sala] no se pudo guardar la subida de nivel:', err); // la memoria manda
      }
      const pm = pmMax(pj.clase, pj.nivel, pj.caracteristicas);
      texto += ` ¡${r.nombre} sube al nivel ${subida.nivel}! +${subida.pg_extra} PG (${pj.pg_max} máx.)${pm ? `, ${pm} PM máx.` : ''}, competencia +${subida.competencia}.`;
    }
    await this.p.publicar(sala, 'estado', autor, { ...extra, cambio: 'xp', personaje_id: personajeId, texto });
  }

  /** Al terminar el combate, la XP de los caídos se reparte entre los personajes de la mesa. */
  async xpDeCombate(sala: Sala, srdClaves: string[]) {
    const ids = sala.estado().jugadores.map((j) => j.personaje_id);
    const cada = repartirXp(srdClaves, ids.length);
    if (!cada) return;
    for (const id of ids) await this.darXp(sala, 'sistema', id, cada);
  }
}
