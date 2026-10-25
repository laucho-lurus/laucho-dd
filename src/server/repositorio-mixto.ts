import type { Monstruo } from '../rules/monstruos.ts';
import type { Campana, EstadoSesion, NuevaImagen, NuevoEvento, Personaje, Repositorio } from './repositorio.ts';

/**
 * Une dos repositorios: las campañas del `local` (la demo en memoria) se quedan ahí,
 * y todo lo demás va al `principal` (Neon). Así la demo convive con las campañas reales.
 */
export class RepositorioMixto implements Repositorio {
  private readonly local: Repositorio;
  private readonly principal: Repositorio;
  private readonly sesionesLocales = new Set<string>();

  constructor(local: Repositorio, principal: Repositorio) {
    this.local = local;
    this.principal = principal;
  }

  private async esLocal(campanaId: string) {
    return (await this.local.buscarCampana(campanaId)) !== null;
  }

  private async para(campanaId: string) {
    return (await this.esLocal(campanaId)) ? this.local : this.principal;
  }

  async listarCampanas() {
    return [...(await this.principal.listarCampanas()), ...(await this.local.listarCampanas())];
  }

  async guardarCampana(id: string | null, datos: Required<Omit<Campana, 'id'>>) {
    // Las campañas nuevas van a la base real; la demo se edita en memoria.
    return (id && (await this.esLocal(id)) ? this.local : this.principal).guardarCampana(id, datos);
  }

  async buscarCampana(id: string) {
    return (await this.local.buscarCampana(id)) ?? this.principal.buscarCampana(id);
  }

  async personajesDeCampana(campanaId: string) {
    return (await this.para(campanaId)).personajesDeCampana(campanaId);
  }

  async crearPersonaje(personaje: Personaje, imagen: NuevaImagen | null) {
    return (await this.para(personaje.campana_id)).crearPersonaje(personaje, imagen);
  }

  async guardarPg(personajeId: string, pgActual: number) {
    // Los ids no se repiten entre repositorios: actualizar donde no existe no hace nada.
    await this.local.guardarPg(personajeId, pgActual);
    await this.principal.guardarPg(personajeId, pgActual);
  }

  async crearSesion(campanaId: string, codigo: string) {
    // El código debe ser único entre ambos.
    if ((await this.local.buscarSesionPorCodigo(codigo)) || (await this.principal.buscarSesionPorCodigo(codigo))) return null;
    if (!(await this.esLocal(campanaId))) return this.principal.crearSesion(campanaId, codigo);
    const sesion = await this.local.crearSesion(campanaId, codigo);
    if (sesion) this.sesionesLocales.add(sesion.id);
    return sesion;
  }

  async buscarSesionPorCodigo(codigo: string) {
    return (await this.local.buscarSesionPorCodigo(codigo)) ?? this.principal.buscarSesionPorCodigo(codigo);
  }

  async guardarEstadoSesion(sesionId: string, estado: EstadoSesion) {
    return (this.sesionesLocales.has(sesionId) ? this.local : this.principal).guardarEstadoSesion(sesionId, estado);
  }

  async criaturasDeCampana(campanaId: string) {
    return (await this.para(campanaId)).criaturasDeCampana(campanaId);
  }

  async monstruosDeSesion(sesionId: string) {
    return (this.sesionesLocales.has(sesionId) ? this.local : this.principal).monstruosDeSesion(sesionId);
  }

  async guardarMonstruos(sesionId: string, monstruos: Monstruo[]) {
    return (this.sesionesLocales.has(sesionId) ? this.local : this.principal).guardarMonstruos(sesionId, monstruos);
  }

  async guardarTokenGm(sesionId: string, hash: string) {
    return (this.sesionesLocales.has(sesionId) ? this.local : this.principal).guardarTokenGm(sesionId, hash);
  }

  async avisosBase() {
    return this.principal.avisosBase();
  }

  async registrarEvento(evento: NuevoEvento) {
    return (this.sesionesLocales.has(evento.sesion_id) ? this.local : this.principal).registrarEvento(evento);
  }

  async ultimosEventos(sesionId: string, limite: number) {
    return (this.sesionesLocales.has(sesionId) ? this.local : this.principal).ultimosEventos(sesionId, limite);
  }
}
