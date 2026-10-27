// Combate en la sala: el servidor resuelve los turnos de los monstruos, las salvaciones de muerte, pifias y críticos.
import {
  acercarse, ataquesPorTurno, conDesventaja, danoACaido, duplicarDados, elegirObjetivo, esADistancia, MUERTE_INICIAL,
  resolverAtaque, salvacionDeMuerte, tirarPifia, type Tirar,
} from '../rules/combate.ts';
import { distancia } from '../rules/mapa.ts';
import type { Evento, TipoEvento } from './repositorio.ts';
import type { Peticion, Sala } from './sala.ts';
import type { RollResult } from '../rules/dice.ts';

export interface PuertosCombate {
  publicar(sala: Sala, tipo: TipoEvento, autor: string, datos: Record<string, unknown>): Promise<Evento | { id: null }>;
  guardarPg(personajeId: string, pg: number): Promise<void>;
  guardarMonstruos(sala: Sala): Promise<void>;
  tirar: Tirar;
  azar: () => number;
  error(mensaje: string): Error;
}

/** Lo que pasó al mover los turnos: para la IA (texto), para "Deshacer IA" (PG) y los eventos publicados. */
export interface ResumenTurnos {
  eventos: (Evento | { id: null })[];
  pg: { personaje_id: string; delta: number }[];
  textos: string[];
}

const vacio = (): ResumenTurnos => ({ eventos: [], pg: [], textos: [] });

export class Combate {
  private readonly p: PuertosCombate;

  constructor(puertos: PuertosCombate) {
    this.p = puertos;
  }

  /** Pasa el turno y resuelve solos los turnos de monstruos (si son automáticos) y de caídos. */
  async pasarTurno(sala: Sala, autor: string, extra: Record<string, unknown>): Promise<ResumenTurnos> {
    const r = vacio();
    await this.avanzar(sala, autor, extra, r);
    await this.resolverAutomaticos(sala, r);
    return r;
  }

  /** Botón del GM: el monstruo que tiene el turno ataca (al objetivo indicado o al que elija el servidor). */
  async atacarMonstruo(sala: Sala, autor: string, monstruoId: string, objetivo: string | undefined): Promise<ResumenTurnos> {
    if (sala.turnoDe() !== monstruoId) throw this.p.error('No es el turno de ese monstruo');
    const r = vacio();
    const derrota = await this.ataqueDeMonstruo(sala, monstruoId, objetivo, r);
    if (!derrota) await this.pasarTurnoEn(sala, autor, r);
    return r;
  }

  private async pasarTurnoEn(sala: Sala, autor: string, r: ResumenTurnos) {
    await this.avanzar(sala, autor, {}, r);
    await this.resolverAutomaticos(sala, r);
  }

  private async avanzar(sala: Sala, autor: string, extra: Record<string, unknown>, r: ResumenTurnos) {
    const s = sala.siguienteTurno();
    if (!s.ok) throw this.p.error(s.error);
    const turno_de = sala.turnoDe();
    const ronda = sala.estado().ronda;
    const texto = `Turno de ${sala.nombreDe(turno_de) ?? '?'} (ronda ${ronda}).`;
    await this.anunciar(sala, autor, { ...extra, cambio: 'turno', turno_de, ronda, texto }, r);
  }

  private async anunciar(sala: Sala, autor: string, datos: Record<string, unknown> & { texto: string }, r: ResumenTurnos) {
    r.eventos.push(await this.p.publicar(sala, 'estado', autor, datos));
    r.textos.push(datos.texto);
  }

  /** Mientras el turno sea de un monstruo automático, de un caído o de quien perdió el turno, se resuelve y se pasa. */
  private async resolverAutomaticos(sala: Sala, r: ResumenTurnos) {
    const tope = 3 * (sala.estado().orden.length + 1);
    for (let i = 0; i < tope; i++) {
      const id = sala.turnoDe();
      if (!id) return;
      if (sala.esMonstruo(id)) {
        if (!sala.enemigosAutomaticos()) return;
        if (await this.ataqueDeMonstruo(sala, id, undefined, r)) return; // cayó el grupo
      } else if (sala.pgDe(id) === 0) {
        if (await this.salvacion(sala, id, r)) return; // 20 natural: se levanta y actúa
      } else if (sala.pierdeTurno.delete(id)) {
        await this.anunciar(sala, 'sistema', { cambio: 'turno', texto: `${sala.nombreDe(id)} pierde el turno recogiendo su arma.` }, r);
      } else return;
      await this.avanzar(sala, 'sistema', {}, r);
    }
  }

  /** Turno de un monstruo: elige objetivo, se acerca si hace falta y ataca (todas las veces de su multiataque). Devuelve true si cayó el grupo. */
  private async ataqueDeMonstruo(sala: Sala, id: string, forzado: string | undefined, r: ResumenTurnos): Promise<boolean> {
    const m = sala.monstruo(id)!;
    const mapa = sala.mapaCompleto();
    const vivos = sala.estado().jugadores.filter((j) => j.pg_actual > 0);
    const objetivo = elegirObjetivo(vivos.map((j) => ({ id: j.personaje_id, pos: mapa?.fichas[j.personaje_id] })), mapa?.fichas[id], forzado ?? sala.objetivoSugerido ?? undefined, this.p.azar());
    sala.objetivoSugerido = null;
    const ataque = m.ataques[0];
    if (!objetivo || !ataque) {
      await this.anunciar(sala, 'sistema', { cambio: 'ataque', texto: `${m.nombre} no tiene a quién atacar.` }, r);
      return false;
    }
    const nombre = sala.nombreDe(objetivo)!;
    let previo = '';
    const desde = mapa?.fichas[id];
    const meta = mapa?.fichas[objetivo];
    if (mapa && desde && meta && !esADistancia(ataque) && distancia(desde, meta) > 1) {
      const ocupada = (x: number, y: number) => Object.values(mapa.fichas).some((f) => f.x === x && f.y === y);
      const libre = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < mapa.ancho && p.y < mapa.alto && !ocupada(p.x, p.y);
      const destino = acercarse(desde, meta, mapa.velocidad, libre);
      if (destino.x !== desde.x || destino.y !== desde.y) sala.moverEnMapa(id, destino, true);
      if (distancia(destino, meta) > 1) {
        await this.anunciar(sala, 'sistema', { cambio: 'ataque', texto: `${m.nombre} avanza hacia ${nombre}, pero no llega a atacar.` }, r);
        await this.p.guardarMonstruos(sala);
        return false;
      }
      previo = `${m.nombre} avanza hasta ${nombre}. `;
      await this.p.guardarMonstruos(sala);
    }
    const lineas: string[] = [];
    const veces = ataquesPorTurno(ataque);
    for (let k = 0; k < veces && (sala.pgDe(objetivo) ?? 0) > 0; k++) {
      const ca = sala.estado().jugadores.find((j) => j.personaje_id === objetivo)?.ca ?? 10;
      const res = resolverAtaque(ataque, ca, this.p.tirar);
      let linea = res.texto;
      if (res.impacta) linea += await this.herir(sala, objetivo, res.dano, r);
      lineas.push(veces > 1 ? `ataque ${k + 1}: ${linea}` : linea);
    }
    const texto = `${previo}${m.nombre} ataca a ${nombre}: ${lineas.join('; ')}.`;
    await this.anunciar(sala, 'sistema', { cambio: 'ataque', monstruo_id: id, personaje_id: objetivo, texto }, r);
    return this.comprobarDerrota(sala, r);
  }

  /** Resta PG a un personaje (con tope en 0). Devuelve el añadido para el texto ("Brisa cae inconsciente"). */
  private async herir(sala: Sala, id: string, dano: number, r: ResumenTurnos): Promise<string> {
    const antes = sala.pgDe(id) ?? 0;
    if (antes === 0) {
      const m = danoACaido(sala.muerteDe(id) ?? MUERTE_INICIAL, false);
      sala.fijarMuerte(id, m);
      return m.muerto ? `. ${sala.nombreDe(id)} muere` : `. ${sala.nombreDe(id)} suma un fallo de muerte`;
    }
    const res = sala.aplicarPg(id, -dano);
    if (!res.ok) return '';
    r.pg.push({ personaje_id: id, delta: res.pg - antes });
    await this.p.guardarPg(id, res.pg);
    if (res.pg > 0) return '';
    sala.fijarMuerte(id, MUERTE_INICIAL);
    return `. ${sala.nombreDe(id)} cae inconsciente`;
  }

  /** Si todos los personajes cayeron: fin del combate, los enemigos se van y el GM puede revivir al grupo. */
  private async comprobarDerrota(sala: Sala, r: ResumenTurnos): Promise<boolean> {
    const jugadores = sala.estado().jugadores;
    if (!jugadores.length || jugadores.some((j) => j.pg_actual > 0)) return false;
    for (const m of sala.listaMonstruos()) sala.quitarMonstruo(m.id);
    await this.p.guardarMonstruos(sala);
    await this.anunciar(sala, 'sistema', { cambio: 'fin_combate', texto: 'Fin del combate: caída del grupo. El GM puede revivirlos.' }, r);
    return true;
  }

  /** Salvación de muerte al inicio del turno de un caído. Devuelve true si se levanta (20 natural) y actúa. */
  private async salvacion(sala: Sala, id: string, r: ResumenTurnos): Promise<boolean> {
    const d20 = this.p.tirar('1d20').total;
    const res = salvacionDeMuerte(sala.muerteDe(id) ?? MUERTE_INICIAL, d20);
    if (res.despierta) {
      const s = sala.aplicarPg(id, 1);
      if (s.ok) {
        r.pg.push({ personaje_id: id, delta: 1 });
        await this.p.guardarPg(id, s.pg);
      }
    } else sala.fijarMuerte(id, res.muerte);
    await this.anunciar(sala, 'sistema', { cambio: 'muerte', personaje_id: id, texto: `${sala.nombreDe(id)}: ${res.texto}` }, r);
    return res.despierta;
  }

  /** El GM estabiliza a un caído. */
  async estabilizar(sala: Sala, autor: string, id: string) {
    const m = sala.muerteDe(id);
    if (!m) throw this.p.error('Ese personaje no está a 0 PG');
    if (m.muerto) throw this.p.error(`${sala.nombreDe(id)} ha muerto: cúralo para revivirlo`);
    sala.fijarMuerte(id, { ...m, estable: true });
    await this.p.publicar(sala, 'estado', autor, { cambio: 'muerte', personaje_id: id, texto: `${sala.nombreDe(id)} queda estable.` });
  }

  /** El GM levanta a todos los caídos con 1 PG. */
  async revivirGrupo(sala: Sala, autor: string) {
    const caidos = sala.estado().jugadores.filter((j) => j.pg_actual === 0);
    if (!caidos.length) throw this.p.error('No hay nadie a 0 PG');
    for (const j of caidos) {
      const s = sala.aplicarPg(j.personaje_id, 1);
      if (s.ok) await this.p.guardarPg(j.personaje_id, s.pg);
    }
    await this.p.publicar(sala, 'estado', autor, { cambio: 'pg', texto: `${caidos.map((j) => j.nombre).join(', ')} vuelven en sí con 1 PG.` });
  }

  /** Antes de tirar: desventaja pendiente por pifia o dados dobles por un crítico previo. */
  prepararTirada(sala: Sala, id: string, p: Peticion): string {
    let notacion = p.notacion;
    if (sala.desventaja.delete(id)) notacion = conDesventaja(notacion);
    if (p.efecto === 'daño' && sala.critico.delete(id)) notacion = duplicarDados(notacion);
    return notacion;
  }

  /** Tras una tirada de ataque: 20 natural deja el próximo daño con dados dobles; 1 natural es pifia (si el GM la tiene activa). */
  async trasTirada(sala: Sala, id: string, p: Peticion, r: RollResult): Promise<string> {
    if (p.efecto !== 'ataque') return '';
    const natural = r.kept[0];
    if (natural === 20) {
      sala.critico.add(id);
      return ' ¡Crítico! El daño tira el doble de dados.';
    }
    if (natural !== 1 || !sala.opciones.pifias) return '';
    const pifia = tirarPifia(this.p.tirar);
    const nombre = sala.nombreDe(id)!;
    let texto = `¡Pifia! ${nombre} ${pifia.texto}`;
    if (pifia.tipo === 'se_hiere' || pifia.tipo === 'hiere_aliado') {
      const otros = sala.estado().jugadores.filter((j) => j.personaje_id !== id && j.pg_actual > 0);
      const victima = pifia.tipo === 'hiere_aliado' && otros.length ? otros[Math.floor(this.p.azar() * otros.length)].personaje_id : id;
      const dano = this.p.tirar('1d4').total;
      const r2 = vacio();
      const extra = await this.herir(sala, victima, dano, r2);
      texto += `${victima === id ? '' : ` (${sala.nombreDe(victima)})`}: ${dano} de daño${extra}`;
    } else if (pifia.tipo === 'pierde_turno') sala.pierdeTurno.add(id);
    else sala.desventaja.add(id);
    await this.p.publicar(sala, 'estado', 'sistema', { cambio: 'pifia', personaje_id: id, texto: `${texto}.` });
    return ` ${texto}.`;
  }
}
