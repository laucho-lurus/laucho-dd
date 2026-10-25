// Mensajes WebSocket cliente → servidor, en JSON, validados a mano.

export const MAX_TEXTO = 2000;
export const MAX_NOTACION = 40;
export const MAX_CHAT = 300;
const MAX_ID = 64;

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
  | { tipo: 'pedir_tirada'; personaje_id: string; notacion?: string; chequeo?: string; motivo?: string; cd?: number }
  | { tipo: 'aplicar_pg'; personaje_id: string; cantidad: number }
  | { tipo: 'narrar_escena' }
  | { tipo: 'pausar_ia'; pausada: boolean }
  | { tipo: 'deshacer_ia' }
  | { tipo: 'ver_diagrama' }
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
      return bien({ tipo: 'pedir_tirada', personaje_id, ...(chequeo ? { chequeo } : { notacion }), ...(motivo && { motivo }), ...(cd !== undefined && { cd }) });
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
