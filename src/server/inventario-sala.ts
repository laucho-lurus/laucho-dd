// Inventario y habilidades en la sala: otorgar, quitar, equipar, beber pociones, usar habilidades y descansar.
import { randomUUID } from 'node:crypto';
import {
  beberPocion, conInventario, descanso, desequipar, equipar, leerInventario, otorgarHabilidad, otorgarItem, quitarHabilidad, quitarItem,
  usarHabilidad, type Inventario, type PedidoHabilidad, type PedidoItem,
} from '../rules/inventario.ts';
import type { RollResult } from '../rules/dice.ts';
import type { DatosPersonaje, Evento, Personaje, TipoEvento } from './repositorio.ts';
import type { Sala } from './sala.ts';

type Res<T> = { ok: true; valor: T } | { ok: false; error: string };

export interface PuertosInventario {
  publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>): Promise<Evento | { id: null }>;
  cambiarDatos<T extends { datos: DatosPersonaje }>(sala: Sala, personajeId: string, fn: (datos: DatosPersonaje, pj: Personaje) => Res<T>): Promise<{ nombre: string; extra: T }>;
  aplicarPg(sala: Sala, autor: string, personajeId: string, cantidad: number, extra: Record<string, unknown>): Promise<unknown>;
  /** PM recuperados en el descanso ("Ilyra +3 PM") o null. */
  descansarPm(sala: Sala, personajeId: string, tipo: 'corto' | 'largo', corto: boolean): Promise<string | null>;
  dado(notacion: string): RollResult;
}

export class InventarioSala {
  private readonly p: PuertosInventario;

  constructor(puertos: PuertosInventario) {
    this.p = puertos;
  }

  /** Como cambiarDatos, pero sobre el inventario (`fn` devuelve el inventario nuevo y lo que haga falta anunciar). */
  cambiarInventario<T extends { inv: Inventario }>(
    sala: Sala, personajeId: string, fn: (inv: Inventario) => Res<T>,
  ): Promise<{ nombre: string; extra: T & { datos: DatosPersonaje } }> {
    return this.p.cambiarDatos(sala, personajeId, (datos) => {
      const r = fn(leerInventario(datos));
      return r.ok ? { ok: true, valor: { ...r.valor, datos: conInventario(datos, r.valor.inv) } } : r;
    });
  }

  /** "Torvald recibe Espada larga": anuncio en la mesa (y estado nuevo para todos). */
  private anunciar(sala: Sala, autor: string, texto: string, extra: Record<string, unknown> = {}) {
    return this.p.publicar(sala, 'estado', autor, { ...extra, cambio: 'inventario', texto });
  }

  /** Da un objeto y lo anuncia. Devuelve la instancia (para que "Deshacer IA" pueda quitarlo). */
  async otorgarItem(sala: Sala, autor: string, personajeId: string, pedido: PedidoItem, extra: Record<string, unknown>) {
    const r = await this.cambiarInventario(sala, personajeId, (inv) => otorgarItem(inv, pedido, () => randomUUID()));
    const { item } = r.extra;
    const evento = await this.anunciar(sala, autor, `${r.nombre} recibe ${item.cantidad > 1 ? `${item.cantidad} × ` : ''}${item.nombre}.`, extra);
    return { evento, instancia: item.instancia, cantidad: item.cantidad };
  }

  async otorgarHabilidad(sala: Sala, autor: string, personajeId: string, pedido: PedidoHabilidad) {
    const r = await this.cambiarInventario(sala, personajeId, (inv) => otorgarHabilidad(inv, pedido, () => randomUUID()));
    await this.anunciar(sala, autor, `${r.nombre} aprende ${r.extra.habilidad.nombre}.`);
  }

  async quitar(sala: Sala, autor: string, personajeId: string, instancia: string, es: 'item' | 'habilidad') {
    const r = await this.cambiarInventario(sala, personajeId, (inv) => {
      const q = es === 'item' ? quitarItem(inv, instancia) : quitarHabilidad(inv, instancia);
      return q.ok ? { ok: true, valor: { inv: q.valor.inv, nombre: 'item' in q.valor ? q.valor.item.nombre : q.valor.habilidad.nombre } } : q;
    });
    await this.anunciar(sala, autor, `${r.nombre} pierde ${r.extra.nombre}.`);
  }

  /** Equipa una instancia, o desequipa una ranura (`instancia` null). */
  async equipar(sala: Sala, personajeId: string, instancia: string | null, ranura: 'arma' | 'armadura' | 'escudo' | null) {
    const pj = sala.personaje(personajeId)!;
    await this.cambiarInventario(sala, personajeId, (inv) => {
      if (instancia === null) return { ok: true, valor: { inv: desequipar(inv, ranura!) } };
      const e = equipar(inv, instancia, pj.caracteristicas);
      return e.ok ? { ok: true, valor: { inv: e.valor } } : e;
    });
    sala.difundir({ tipo: 'estado', estado: sala.estado() });
  }

  /** Bebe una poción: el servidor tira la curación y se anuncia lo que cura de verdad (tope en PG máx.). */
  async usarItem(sala: Sala, autor: string, personajeId: string, instancia: string) {
    const r = await this.cambiarInventario(sala, personajeId, (inv) => beberPocion(inv, instancia));
    const curacion = this.p.dado(r.extra.curacion);
    const falta = sala.personaje(personajeId)!.pg_max - (sala.pgDe(personajeId) ?? 0);
    const motivo = `${r.extra.nombre}: ${curacion.notation} = ${curacion.total} [${curacion.kept.join(', ')}]`;
    await this.p.aplicarPg(sala, autor, personajeId, Math.min(curacion.total, falta), { motivo });
  }

  async usarHabilidad(sala: Sala, autor: string, personajeId: string, instancia: string) {
    const r = await this.cambiarInventario(sala, personajeId, (inv) => usarHabilidad(inv, instancia));
    const h = r.extra.habilidad;
    const usos = h.uso === 'a_voluntad' ? '' : ` (le quedan ${h.usos_restantes} de ${h.usos_max})`;
    await this.anunciar(sala, autor, `${r.nombre} usa ${h.nombre}${usos}: ${h.descripcion}`);
  }

  /** Descanso del grupo: habilidades y maná. */
  async descanso(sala: Sala, autor: string, tipo: 'corto' | 'largo', pmCorto: boolean) {
    const pm: string[] = [];
    for (const j of sala.estado().jugadores) {
      await this.cambiarInventario(sala, j.personaje_id, (inv) => ({ ok: true, valor: { inv: descanso(inv, tipo) } }));
      const r = await this.p.descansarPm(sala, j.personaje_id, tipo, pmCorto);
      if (r) pm.push(r);
    }
    const mana = pm.length ? ` Maná: ${pm.join(', ')}.` : '';
    await this.anunciar(sala, autor, `El grupo hace un descanso ${tipo}: se recuperan las habilidades.${mana}`);
  }
}
