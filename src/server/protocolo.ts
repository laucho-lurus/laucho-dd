// Mensajes WebSocket cliente → servidor, en JSON, validados a mano.
import type { PedidoHabilidad, PedidoItem } from '../rules/inventario.ts';

export const MAX_TEXTO = 2000;
export const MAX_NOTACION = 40;
export const MAX_CHAT = 300;
const MAX_ID = 64;
const MAX_XP_CAMBIO = 100_000;

export type MensajeCliente =
  | { tipo: 'ver_campanas' }
  | { tipo: 'crear_sesion'; campana_id: string; gm_perfil_id?: string }
  | { tipo: 'ver_personajes'; codigo: string }
  | { tipo: 'unirse'; codigo: string; personaje_id: string }
  | { tipo: 'retomar_gm'; codigo: string; token_gm: string }
  | { tipo: 'accion'; texto: string }
  | { tipo: 'narracion'; texto: string }
  | { tipo: 'tirar'; notacion: string; motivo?: string }
  | { tipo: 'definir_orden'; orden: string[] }
  | { tipo: 'pedir_tirada'; personaje_id: string; notacion?: string; chequeo?: string; motivo?: string; cd?: number; objetivo_monstruo?: string; efecto?: 'ataque' | 'daño' }
  | { tipo: 'aplicar_pg'; personaje_id: string; cantidad: number }
  | { tipo: 'narrar_escena' }
  | { tipo: 'pausar_ia'; pausada: boolean }
  | { tipo: 'deshacer_ia' }
  | { tipo: 'ver_diagrama' }
  | { tipo: 'otorgar'; personaje_id: string; item?: PedidoItem; habilidad?: PedidoHabilidad }
  | { tipo: 'quitar'; personaje_id: string; instancia: string; es: 'item' | 'habilidad' }
  | { tipo: 'equipar'; personaje_id?: string; instancia: string }
  | { tipo: 'desequipar'; personaje_id?: string; ranura: 'arma' | 'armadura' | 'escudo' }
  | { tipo: 'usar_item'; personaje_id?: string; instancia: string }
  | { tipo: 'usar_habilidad'; personaje_id?: string; instancia: string }
  | { tipo: 'descanso'; descanso: 'corto' | 'largo'; pm_corto?: boolean }
  | { tipo: 'lanzar'; hechizo_id: string; objetivo_monstruo?: string; objetivo_personaje?: string }
  | { tipo: 'dar_xp'; personaje_id?: string; cantidad: number }
  | { tipo: 'ajustar_pm'; personaje_id: string; cantidad: number }
  | { tipo: 'mostrar_introduccion'; texto?: string }
  | { tipo: 'mostrar_imagen'; url: string; titulo?: string }
  | { tipo: 'mapa_configurar'; ancho: number; alto: number; velocidad: number }
  | { tipo: 'mapa_fondo'; url: string | null }
  | { tipo: 'mover_ficha'; id: string; x: number; y: number }
  | { tipo: 'niebla'; celdas: { x: number; y: number }[]; oculta: boolean }
  | { tipo: 'agregar_monstruos'; srd_clave: string; cantidad: number }
  | { tipo: 'quitar_monstruo'; monstruo_id: string }
  | { tipo: 'monstruo_pg'; monstruo_id: string; cantidad: number }
  | { tipo: 'chat'; texto: string; en_personaje: boolean }
  | { tipo: 'ia_permitir_pg'; permitido: boolean }
  | { tipo: 'cambiar_nodo'; nodo_id: string }
  | { tipo: 'siguiente_turno' }
  | { tipo: 'atacar_monstruo'; monstruo_id: string; objetivo_personaje?: string }
  | { tipo: 'opciones_combate'; enemigos_auto?: boolean; pifias?: boolean }
  | { tipo: 'estabilizar'; personaje_id: string }
  | { tipo: 'revivir_grupo' }
  | { tipo: 'estado' };

export type Validacion = { ok: true; mensaje: MensajeCliente } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const falla = (error: string): Validacion => ({ ok: false, error });
const bien = (mensaje: MensajeCliente): Validacion => ({ ok: true, mensaje });

/** Texto no vacío (tras recortar) y con longitud máxima. Devuelve el texto recortado o un error. */
function texto(o: Obj, campo: string, max: number): string | { error: string } {
  const v = o[campo];
  if (typeof v !== 'string') return { error: `Falta "${campo}" (texto)` };
  const t = v.trim();
  if (!t) return { error: `"${campo}" está vacío` };
  if (t.length > max) return { error: `"${campo}" supera ${max} caracteres` };
  return t;
}

/** Entero opcional dentro de [min, max]. undefined si no viene. */
function entero(o: Obj, campo: string, min: number, max: number): number | undefined | { error: string } {
  const v = o[campo];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    return { error: `"${campo}" debe ser un entero entre ${min} y ${max}` };
  }
  return v;
}

export const MAX_CD = 40;
export const MAX_PG_CAMBIO = 999;

const esError = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null;

/** Normaliza un código de sala: mayúsculas y sin espacios. */
export const normalizarCodigo = (c: string) => c.replace(/\s/g, '').toUpperCase();

export function validarMensaje(crudo: string): Validacion {
  let o: unknown;
  try {
    o = JSON.parse(crudo);
  } catch {
    return falla('El mensaje no es JSON válido');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return falla('El mensaje debe ser un objeto');
  const m = o as Obj;

  switch (m.tipo) {
    case 'crear_sesion': {
      const campana_id = texto(m, 'campana_id', MAX_ID);
      if (esError(campana_id)) return falla(campana_id.error);
      if (m.gm_perfil_id === undefined || m.gm_perfil_id === '') return bien({ tipo: 'crear_sesion', campana_id });
      const gm_perfil_id = texto(m, 'gm_perfil_id', MAX_ID);
      return esError(gm_perfil_id) ? falla(gm_perfil_id.error) : bien({ tipo: 'crear_sesion', campana_id, gm_perfil_id });
    }
    case 'ver_personajes': {
      const codigo = texto(m, 'codigo', MAX_ID);
      return esError(codigo) ? falla(codigo.error) : bien({ tipo: 'ver_personajes', codigo: normalizarCodigo(codigo) });
    }
    case 'unirse': {
      const codigo = texto(m, 'codigo', MAX_ID);
      if (esError(codigo)) return falla(codigo.error);
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      return bien({ tipo: 'unirse', codigo: normalizarCodigo(codigo), personaje_id });
    }
    case 'retomar_gm': {
      const codigo = texto(m, 'codigo', MAX_ID);
      if (esError(codigo)) return falla(codigo.error);
      const token_gm = texto(m, 'token_gm', MAX_ID);
      if (esError(token_gm)) return falla(token_gm.error);
      return bien({ tipo: 'retomar_gm', codigo: normalizarCodigo(codigo), token_gm });
    }
    case 'accion':
    case 'narracion': {
      const t = texto(m, 'texto', MAX_TEXTO);
      return esError(t) ? falla(t.error) : bien({ tipo: m.tipo, texto: t });
    }
    case 'tirar': {
      const notacion = texto(m, 'notacion', MAX_NOTACION);
      if (esError(notacion)) return falla(notacion.error);
      if (m.motivo === undefined) return bien({ tipo: 'tirar', notacion });
      const motivo = texto(m, 'motivo', MAX_ID * 2);
      return esError(motivo) ? falla(motivo.error) : bien({ tipo: 'tirar', notacion, motivo });
    }
    case 'pedir_tirada': {
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      // O un chequeo ("percepcion", "salvacion_des") o una notación libre.
      const chequeo = m.chequeo === undefined ? undefined : texto(m, 'chequeo', MAX_ID);
      if (esError(chequeo)) return falla(chequeo.error);
      const notacion = chequeo ? undefined : texto(m, 'notacion', MAX_NOTACION);
      if (esError(notacion)) return falla(notacion.error);
      const motivo = m.motivo === undefined || m.motivo === '' ? undefined : texto(m, 'motivo', MAX_ID * 2);
      if (esError(motivo)) return falla(motivo.error);
      const cd = entero(m, 'cd', 1, MAX_CD);
      if (esError(cd)) return falla(cd.error);
      const objetivo_monstruo = m.objetivo_monstruo === undefined || m.objetivo_monstruo === '' ? undefined : texto(m, 'objetivo_monstruo', MAX_ID);
      if (esError(objetivo_monstruo)) return falla(objetivo_monstruo.error);
      if (m.efecto !== undefined && m.efecto !== 'ataque' && m.efecto !== 'daño') return falla('"efecto" debe ser ataque o daño');
      if (objetivo_monstruo && !m.efecto) return falla('Con "objetivo_monstruo" indica "efecto" (ataque o daño)');
      return bien({
        tipo: 'pedir_tirada', personaje_id, ...(chequeo ? { chequeo } : { notacion }), ...(motivo && { motivo }), ...(cd !== undefined && { cd }),
        ...(objetivo_monstruo && { objetivo_monstruo, efecto: m.efecto as 'ataque' | 'daño' }),
      });
    }
    case 'aplicar_pg': {
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      const cantidad = entero(m, 'cantidad', -MAX_PG_CAMBIO, MAX_PG_CAMBIO);
      if (esError(cantidad)) return falla(cantidad.error);
      if (!cantidad) return falla('"cantidad" debe ser un entero distinto de 0');
      return bien({ tipo: 'aplicar_pg', personaje_id, cantidad });
    }
    case 'definir_orden': {
      const orden = m.orden;
      if (!Array.isArray(orden) || !orden.every((id) => typeof id === 'string' && id.length <= MAX_ID)) {
        return falla('"orden" debe ser una lista de ids de personaje');
      }
      return bien({ tipo: 'definir_orden', orden });
    }
    case 'pausar_ia':
      if (typeof m.pausada !== 'boolean') return falla('"pausada" debe ser true o false');
      return bien({ tipo: 'pausar_ia', pausada: m.pausada });
    case 'agregar_monstruos': {
      const srd_clave = texto(m, 'srd_clave', MAX_ID);
      if (esError(srd_clave)) return falla(srd_clave.error);
      const cantidad = entero(m, 'cantidad', 1, 6);
      if (esError(cantidad) || cantidad === undefined) return falla('"cantidad" debe ser un entero entre 1 y 6');
      return bien({ tipo: 'agregar_monstruos', srd_clave, cantidad });
    }
    case 'quitar_monstruo':
    case 'monstruo_pg': {
      const monstruo_id = texto(m, 'monstruo_id', MAX_ID);
      if (esError(monstruo_id)) return falla(monstruo_id.error);
      if (m.tipo === 'quitar_monstruo') return bien({ tipo: 'quitar_monstruo', monstruo_id });
      const cantidad = entero(m, 'cantidad', -MAX_PG_CAMBIO, MAX_PG_CAMBIO);
      if (esError(cantidad) || !cantidad) return falla('"cantidad" debe ser un entero distinto de 0');
      return bien({ tipo: 'monstruo_pg', monstruo_id, cantidad });
    }
    case 'mapa_configurar': {
      const ancho = entero(m, 'ancho', 1, 100);
      const alto = entero(m, 'alto', 1, 100);
      const velocidad = entero(m, 'velocidad', 1, 100);
      if (esError(ancho) || esError(alto) || esError(velocidad) || !ancho || !alto) return falla('"ancho", "alto" y "velocidad" deben ser enteros');
      return bien({ tipo: 'mapa_configurar', ancho, alto, velocidad: velocidad ?? 6 });
    }
    case 'otorgar': {
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      // La forma fina (catálogo, límites) la valida src/rules/inventario.ts.
      const item = m.item as PedidoItem | undefined;
      const habilidad = m.habilidad as PedidoHabilidad | undefined;
      if ((item === undefined) === (habilidad === undefined) || typeof (item ?? habilidad) !== 'object' || (item ?? habilidad) === null) {
        return falla('Indica un "item" o una "habilidad"');
      }
      return bien({ tipo: 'otorgar', personaje_id, ...(item ? { item } : { habilidad }) });
    }
    case 'quitar': {
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      const instancia = texto(m, 'instancia', MAX_ID);
      if (esError(personaje_id) || esError(instancia)) return falla('Faltan "personaje_id" e "instancia"');
      if (m.es !== 'item' && m.es !== 'habilidad') return falla('"es" debe ser item o habilidad');
      return bien({ tipo: 'quitar', personaje_id, instancia, es: m.es });
    }
    case 'equipar':
    case 'usar_item':
    case 'usar_habilidad': {
      const instancia = texto(m, 'instancia', MAX_ID);
      if (esError(instancia)) return falla(instancia.error);
      const personaje_id = m.personaje_id === undefined ? undefined : texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      return bien({ tipo: m.tipo, instancia, ...(personaje_id && { personaje_id }) });
    }
    case 'desequipar': {
      if (m.ranura !== 'arma' && m.ranura !== 'armadura' && m.ranura !== 'escudo') return falla('"ranura" debe ser arma, armadura o escudo');
      const personaje_id = m.personaje_id === undefined ? undefined : texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      return bien({ tipo: 'desequipar', ranura: m.ranura, ...(personaje_id && { personaje_id }) });
    }
    case 'descanso':
      if (m.descanso !== 'corto' && m.descanso !== 'largo') return falla('"descanso" debe ser corto o largo');
      if (m.pm_corto !== undefined && typeof m.pm_corto !== 'boolean') return falla('"pm_corto" debe ser verdadero o falso');
      return bien({ tipo: 'descanso', descanso: m.descanso, ...(m.pm_corto !== undefined && { pm_corto: m.pm_corto }) });
    case 'lanzar': {
      const hechizo_id = texto(m, 'hechizo_id', MAX_ID);
      if (esError(hechizo_id)) return falla(hechizo_id.error);
      const opcional = (campo: string) => (m[campo] === undefined || m[campo] === null || m[campo] === '' ? undefined : texto(m, campo, MAX_ID));
      const objetivo_monstruo = opcional('objetivo_monstruo');
      const objetivo_personaje = opcional('objetivo_personaje');
      if (esError(objetivo_monstruo) || esError(objetivo_personaje)) return falla('Objetivo inválido');
      return bien({ tipo: 'lanzar', hechizo_id, ...(objetivo_monstruo && { objetivo_monstruo }), ...(objetivo_personaje && { objetivo_personaje }) });
    }
    case 'dar_xp':
    case 'ajustar_pm': {
      const cantidad = entero(m, 'cantidad', -MAX_XP_CAMBIO, MAX_XP_CAMBIO);
      if (esError(cantidad)) return falla(cantidad.error);
      if (!cantidad) return falla('"cantidad" debe ser un entero distinto de 0');
      const personaje_id = m.personaje_id === undefined || m.personaje_id === '' ? undefined : texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      if (m.tipo === 'ajustar_pm') {
        if (!personaje_id) return falla('Falta "personaje_id"');
        return bien({ tipo: 'ajustar_pm', personaje_id, cantidad });
      }
      return bien({ tipo: 'dar_xp', cantidad, ...(personaje_id && { personaje_id }) });
    }
    case 'mostrar_introduccion': {
      if (m.texto === undefined) return bien({ tipo: 'mostrar_introduccion' });
      const t = texto(m, 'texto', 3000);
      return esError(t) ? falla(t.error) : bien({ tipo: 'mostrar_introduccion', texto: t });
    }
    case 'mostrar_imagen': {
      // Solo imágenes subidas a este servidor.
      if (typeof m.url !== 'string' || !/^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(m.url)) return falla('Imagen inválida');
      const titulo = m.titulo === undefined ? undefined : texto(m, 'titulo', 200);
      if (esError(titulo)) return falla(titulo.error);
      return bien({ tipo: 'mostrar_imagen', url: m.url, ...(titulo && { titulo }) });
    }
    case 'mapa_fondo': {
      if (m.url === null) return bien({ tipo: 'mapa_fondo', url: null });
      // Solo imágenes subidas a este servidor.
      if (typeof m.url !== 'string' || !/^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(m.url)) return falla('Fondo inválido: sube la imagen primero');
      return bien({ tipo: 'mapa_fondo', url: m.url });
    }
    case 'mover_ficha': {
      const id = texto(m, 'id', MAX_ID);
      const x = entero(m, 'x', -1000, 1000);
      const y = entero(m, 'y', -1000, 1000);
      if (esError(id)) return falla(id.error);
      if (esError(x) || esError(y) || x === undefined || y === undefined) return falla('"x" e "y" deben ser enteros');
      return bien({ tipo: 'mover_ficha', id, x, y });
    }
    case 'niebla': {
      const celdas = m.celdas;
      if (!Array.isArray(celdas) || celdas.length > 3600 || !celdas.every((c) => Number.isInteger(c?.x) && Number.isInteger(c?.y))) {
        return falla('"celdas" debe ser una lista de {x, y} (máx. 3600)');
      }
      if (typeof m.oculta !== 'boolean') return falla('"oculta" debe ser true o false');
      return bien({ tipo: 'niebla', celdas: celdas.map((c: { x: number; y: number }) => ({ x: c.x, y: c.y })), oculta: m.oculta });
    }
    case 'chat': {
      const t = texto(m, 'texto', MAX_CHAT);
      if (esError(t)) return falla(t.error);
      return bien({ tipo: 'chat', texto: t, en_personaje: m.en_personaje === true });
    }
    case 'ia_permitir_pg':
      if (typeof m.permitido !== 'boolean') return falla('"permitido" debe ser true o false');
      return bien({ tipo: 'ia_permitir_pg', permitido: m.permitido });
    case 'cambiar_nodo': {
      const nodo_id = texto(m, 'nodo_id', MAX_ID);
      return esError(nodo_id) ? falla(nodo_id.error) : bien({ tipo: 'cambiar_nodo', nodo_id });
    }
    case 'atacar_monstruo': {
      const monstruo_id = texto(m, 'monstruo_id', MAX_ID);
      if (esError(monstruo_id)) return falla(monstruo_id.error);
      const objetivo = m.objetivo_personaje === undefined || m.objetivo_personaje === '' ? undefined : texto(m, 'objetivo_personaje', MAX_ID);
      if (esError(objetivo)) return falla(objetivo.error);
      return bien({ tipo: 'atacar_monstruo', monstruo_id, ...(objetivo && { objetivo_personaje: objetivo }) });
    }
    case 'opciones_combate': {
      for (const campo of ['enemigos_auto', 'pifias']) {
        if (m[campo] !== undefined && typeof m[campo] !== 'boolean') return falla(`"${campo}" debe ser verdadero o falso`);
      }
      return bien({
        tipo: 'opciones_combate',
        ...(typeof m.enemigos_auto === 'boolean' && { enemigos_auto: m.enemigos_auto }),
        ...(typeof m.pifias === 'boolean' && { pifias: m.pifias }),
      });
    }
    case 'estabilizar': {
      const personaje_id = texto(m, 'personaje_id', MAX_ID);
      if (esError(personaje_id)) return falla(personaje_id.error);
      return bien({ tipo: 'estabilizar', personaje_id });
    }
    case 'revivir_grupo':
      return bien({ tipo: 'revivir_grupo' });
    case 'narrar_escena':
    case 'ver_diagrama':
    case 'deshacer_ia':
    case 'ver_campanas':
    case 'siguiente_turno':
    case 'estado':
      return bien({ tipo: m.tipo });
    default:
      return falla(`Tipo de mensaje desconocido: ${JSON.stringify(m.tipo)}`);
  }
}
