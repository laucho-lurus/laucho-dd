// API HTTP de creación de personajes y archivos subidos.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ALINEAMIENTOS, CLASES, METODOS, RAZAS } from '../rules/personaje.ts';
import { randomUUID } from 'node:crypto';
import { crearPersonaje, leerImagen, MAX_IMAGEN_BYTES, TiradasCaracteristicas, type Dependencias } from './creacion.ts';
import type { Repositorio } from './repositorio.ts';
import { normalizarCampana, validarDiagrama } from '../rules/diagrama.ts';
import { unirCriaturas } from '../rules/monstruos.ts';
import { DIFICULTADES, validarPerfil, type AlmacenPerfiles } from '../ia/perfiles.ts';
import type { Almacen } from './almacen.ts';
import { borrarImagen, imagenesDeLaCampana, MAX_IMAGEN_GM_BYTES, subirImagen } from './imagenes.ts';
import { sanear } from '../rules/imagenes.ts';
import { CATALOGO } from '../rules/items.ts';
import { RASGOS } from '../rules/rasgos.ts';
import { HECHIZOS, LANZADORES } from '../rules/hechizos.ts';
import { COSTO_PM } from '../rules/magia.ts';

const MAX_CUERPO_BYTES = Math.ceil(MAX_IMAGEN_BYTES * 1.4) + 64 * 1024; // base64 + resto del formulario
const MAX_CUERPO_GM_BYTES = Math.ceil(MAX_IMAGEN_GM_BYTES * 1.4) + 64 * 1024;
/** Los archivos subidos nunca se interpretan: tipo fijo, sin sniffing y sin poder ejecutar nada. */
const CABECERAS_SUBIDOS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'content-disposition': 'inline',
  'cache-control': 'public, max-age=3600',
};
const ARCHIVO_SUBIDO = /^\/uploads\/([0-9a-f-]{36}\.(png|jpg|webp))$/;
const TIPOS_IMAGEN: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

class CuerpoDemasiadoGrande extends Error {}

function json(res: ServerResponse, estado: number, datos: unknown) {
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(datos));
}

async function leerJson(req: IncomingMessage, limite = MAX_CUERPO_BYTES): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > limite) throw new CuerpoDemasiadoGrande();
    partes.push(parte as Buffer);
  }
  const crudo = Buffer.concat(partes).toString('utf8');
  return JSON.parse(crudo) as unknown;
}

const opciones = (tabla: Readonly<Record<string, { nombre: string }>>) =>
  Object.entries(tabla).map(([clave, v]) => ({ clave, ...v }));

/** Lee el cuerpo JSON y responde el error si no se puede. Devuelve null si ya respondió. */
async function cuerpoJson(req: IncomingMessage, res: ServerResponse, limite?: number): Promise<Record<string, unknown> | null> {
  try {
    return (await leerJson(req, limite)) as Record<string, unknown>;
  } catch (err) {
    const grande = err instanceof CuerpoDemasiadoGrande;
    json(res, grande ? 413 : 400, { error: grande ? 'La imagen es demasiado grande' : 'Petición inválida' });
    return null;
  }
}

export function crearApi(repo: Repositorio, perfiles: AlmacenPerfiles, almacen: Almacen) {
  const deps: Dependencias = {
    repo,
    tiradas: new TiradasCaracteristicas(),
    guardarArchivo: (nombre, contenido) => almacen.guardar(nombre, contenido),
  };

  /** Página /imagenes: listar por campaña, subir (con dueño) y borrar. */
  async function atenderImagenes(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<boolean> {
    if (req.method === 'GET' && ruta === '/api/imagenes') {
      const campana = new URL(req.url ?? '/', 'http://local').searchParams.get('campana') ?? '';
      const datos = await imagenesDeLaCampana(repo, campana);
      if (!datos) json(res, 404, { error: 'No existe esa campaña' });
      else json(res, 200, datos);
      return true;
    }
    if (req.method === 'POST' && ruta === '/api/imagenes') {
      const cuerpo = await cuerpoJson(req, res, MAX_CUERPO_GM_BYTES);
      if (!cuerpo) return true;
      const r = await subirImagen(repo, almacen, cuerpo);
      if (r.ok) json(res, 201, { imagen: r.valor });
      else json(res, 400, { error: r.error });
      return true;
    }
    const borrar = /^\/api\/imagenes\/([0-9a-f-]{1,64})$/i.exec(ruta);
    if (req.method === 'DELETE' && borrar) {
      if (await borrarImagen(repo, almacen, borrar[1])) json(res, 200, { ok: true });
      else json(res, 404, { error: 'No existe esa imagen' });
      return true;
    }
    return false;
  }

  /** Editor de campañas: listar, abrir, validar y guardar; criaturas para los combates. */
  async function atenderCampanas(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method === 'GET' && ruta === '/api/catalogo') {
      // Objetos y habilidades de clase para el panel del GM y el editor.
      json(res, 200, { items: Object.values(CATALOGO), rasgos: RASGOS, hechizos: Object.values(HECHIZOS), lanzadores: LANZADORES, costo_pm: COSTO_PM });
      return true;
    }
    if (req.method === 'GET' && ruta === '/api/criaturas') {
      const id = url.searchParams.get('campana') ?? '';
      json(res, 200, { criaturas: unirCriaturas(id ? await repo.criaturasDeCampana(id) : []) });
      return true;
    }
    if (req.method === 'GET' && ruta === '/api/campanas') {
      json(res, 200, { campanas: (await repo.listarCampanas()).map(({ id, nombre }) => ({ id, nombre })) });
      return true;
    }
    const abrir = /^\/api\/campanas\/([\w-]{1,64})$/.exec(ruta);
    if (req.method === 'GET' && abrir) {
      const c = await repo.buscarCampana(abrir[1]);
      if (!c) json(res, 404, { error: 'No existe esa campaña' });
      else json(res, 200, { campana: { diagrama: { nodos: [], flechas: [] }, variables: {}, resumen: '', ...c } });
      return true;
    }
    if (req.method === 'POST' && (ruta === '/api/campanas' || ruta === '/api/campanas/validar')) {
      let cuerpo: Record<string, unknown>;
      try {
        cuerpo = (await leerJson(req)) as Record<string, unknown>;
      } catch {
        json(res, 400, { error: 'Petición inválida' });
        return true;
      }
      const n = normalizarCampana(cuerpo);
      if (!n.ok) {
        json(res, 400, { error: n.error });
        return true;
      }
      const avisos = validarDiagrama(n.valor.diagrama, n.valor.variables); // avisan, no bloquean
      if (ruta === '/api/campanas/validar') {
        json(res, 200, { avisos });
        return true;
      }
      const id = typeof cuerpo.id === 'string' && cuerpo.id ? cuerpo.id : null;
      try {
        const campana = await repo.guardarCampana(id, n.valor);
        console.log(`[api] campaña guardada: ${campana.nombre} (${campana.id})`);
        json(res, id ? 200 : 201, { campana, avisos });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }
    return false;
  }

  /** Atiende la petición si es de la API o de /uploads. Devuelve false si no le toca. */
  return async function atender(req: IncomingMessage, res: ServerResponse, ruta: string): Promise<boolean> {
    try {
      if (req.method === 'GET' && ruta === '/api/opciones') {
        json(res, 200, {
          razas: opciones(RAZAS),
          clases: opciones(CLASES),
          alineamientos: ALINEAMIENTOS,
          metodos: METODOS,
          campanas: (await repo.listarCampanas()).map(({ id, nombre }) => ({ id, nombre })),
        });
        return true;
      }
      if (ruta.startsWith('/api/campanas') || ruta === '/api/criaturas' || ruta === '/api/catalogo') return await atenderCampanas(req, res, ruta);
      if (ruta.startsWith('/api/imagenes')) return await atenderImagenes(req, res, ruta);
      if (req.method === 'GET' && ruta === '/api/perfiles') {
        json(res, 200, { perfiles: await perfiles.listar(), dificultades: DIFICULTADES });
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/perfiles') {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await leerJson(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Petición inválida' });
          return true;
        }
        const v = validarPerfil(cuerpo);
        if (!v.ok) {
          json(res, 400, { error: v.error });
          return true;
        }
        const id = typeof cuerpo?.id === 'string' && cuerpo.id ? cuerpo.id : null;
        if (id && !(await perfiles.buscar(id))) {
          json(res, 404, { error: 'No existe ese perfil' });
          return true;
        }
        json(res, id ? 200 : 201, { perfil: await perfiles.guardarPerfil(id, v.perfil) });
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/mapas/fondo') {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await leerJson(req)) as Record<string, unknown>;
        } catch (err) {
          json(res, err instanceof CuerpoDemasiadoGrande ? 413 : 400, { error: err instanceof CuerpoDemasiadoGrande ? 'La imagen supera 2 MB' : 'Petición inválida' });
          return true;
        }
        // Con campaña, el fondo queda registrado (y reutilizable) en la tabla imagenes.
        if (typeof cuerpo?.campana_id === 'string' && cuerpo.campana_id) {
          const nombre = sanear(typeof cuerpo.nombre === 'string' && cuerpo.nombre ? cuerpo.nombre : 'fondo') || 'fondo';
          const r = await subirImagen(repo, almacen, { imagen: cuerpo.imagen, pertenece: { tipo: 'fondo', clave: nombre, campana_id: cuerpo.campana_id } });
          if (r.ok) json(res, 201, { url: r.valor.url });
          else json(res, 400, { error: r.error });
          return true;
        }
        const imagen = leerImagen(cuerpo?.imagen);
        if (!imagen.ok) {
          json(res, 400, { error: imagen.error });
          return true;
        }
        const archivo = `${randomUUID()}.${imagen.valor.ext}`;
        await deps.guardarArchivo(archivo, imagen.valor.contenido);
        json(res, 201, { url: `/uploads/${archivo}` });
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/caracteristicas/tirar') {
        json(res, 200, deps.tiradas.tirar());
        return true;
      }
      if (req.method === 'POST' && ruta === '/api/personajes') {
        let cuerpo;
        try {
          cuerpo = await leerJson(req);
        } catch (err) {
          json(res, err instanceof CuerpoDemasiadoGrande ? 413 : 400, {
            error: err instanceof CuerpoDemasiadoGrande ? 'La imagen supera 2 MB' : 'Petición inválida',
          });
          return true;
        }
        const r = await crearPersonaje(deps, cuerpo);
        if (r.ok) {
          console.log(`[api] personaje creado: ${r.valor.nombre} (campaña ${r.valor.campana_id})`);
          json(res, 201, { personaje: r.valor });
        } else {
          console.warn(`[api] creación de personaje rechazada: ${r.error}`);
          json(res, 400, { error: r.error });
        }
        return true;
      }
      const subido = req.method === 'GET' ? ARCHIVO_SUBIDO.exec(ruta) : null;
      if (subido) {
        const contenido = await almacen.leer(subido[1]);
        if (contenido) res.writeHead(200, { 'content-type': TIPOS_IMAGEN[subido[2]], ...CABECERAS_SUBIDOS }).end(contenido);
        else res.writeHead(404).end();
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[api] error en ${req.method} ${ruta}:`, err);
      json(res, 500, { error: 'Error interno del servidor' });
      return true;
    }
  };
}
