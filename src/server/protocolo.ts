// Mensajes WebSocket cliente → servidor, en JSON, validados a mano.

export const MAX_TEXTO = 2000;
export const MAX_NOTACION = 40;
const MAX_ID = 64;

export type MensajeCliente =
  | { tipo: 'crear_sesion'; campana_id: string }
  | { tipo: 'ver_personajes'; codigo: string }
  | { tipo: 'unirse'; codigo: string; personaje_id: string }
  | { tipo: 'retomar_gm'; codigo: string; token_gm: string }
  | { tipo: 'accion'; texto: string }
  | { tipo: 'narracion'; texto: string }
  | { tipo: 'tirar'; notacion: string; motivo?: string }
  | { tipo: 'definir_orden'; orden: string[] }
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
      return esError(campana_id) ? falla(campana_id.error) : bien({ tipo: 'crear_sesion', campana_id });
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
    case 'definir_orden': {
      const orden = m.orden;
      if (!Array.isArray(orden) || !orden.every((id) => typeof id === 'string' && id.length <= MAX_ID)) {
        return falla('"orden" debe ser una lista de ids de personaje');
      }
      return bien({ tipo: 'definir_orden', orden });
    }
    case 'siguiente_turno':
    case 'estado':
      return bien({ tipo: m.tipo });
    default:
      return falla(`Tipo de mensaje desconocido: ${JSON.stringify(m.tipo)}`);
  }
}
