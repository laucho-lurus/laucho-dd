import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { Gestor } from './gestor.ts';
import type { crearApi } from './api.ts';

const PUBLICO = new URL('../../public/', import.meta.url);
const TIPOS: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};
const ALIAS: Record<string, string> = { '/': 'index.html', '/prueba': 'prueba.html', '/personaje': 'personaje.html' };
/** Solo nombres simples dentro de public/ (y public/js/): nada de "..". */
const RUTA_SEGURA = /^\/(?:js\/)?[a-z0-9-]+\.(html|css|js)$/;

function archivoPublico(url: string): { archivo: URL; tipo: string } | null {
  const ruta = ALIAS[url] ? `/${ALIAS[url]}` : url;
  const m = RUTA_SEGURA.exec(ruta);
  return m ? { archivo: new URL(ruta.slice(1), PUBLICO), tipo: TIPOS[m[1]] } : null;
}
const MAX_MENSAJE_BYTES = 16 * 1024;
const LATIDO_MS = 30_000;

/** Servidor HTTP que sirve public/index.html y acepta WebSockets en /ws. */
export function crearServidor(gestor: Gestor, api: ReturnType<typeof crearApi>): Server {
  const http = createServer(async (req, res) => {
    const ruta = (req.url ?? '/').split('?')[0];
    const publico = req.method === 'GET' ? archivoPublico(ruta) : null;
    if (publico) {
      try {
        const contenido = await readFile(publico.archivo);
        res.writeHead(200, { 'content-type': publico.tipo }).end(contenido);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[http] no se pudo leer ${ruta}:`, err);
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
      }
      return;
    }
    if (await api(req, res, ruta)) return;
    if (req.method === 'GET' && ruta === '/salud') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MENSAJE_BYTES });
  const vivos = new WeakSet<WebSocket>();

  wss.on('connection', (ws) => {
    vivos.add(ws);
    ws.on('pong', () => vivos.add(ws));
    const conexion = gestor.conectar({
      enviar: (m) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      },
    });
    ws.on('message', (datos, esBinario) => {
      if (esBinario) return ws.send(JSON.stringify({ tipo: 'error', mensaje: 'Solo se aceptan mensajes de texto' }));
      void conexion.recibir(datos.toString());
    });
    ws.on('close', () => conexion.cerrar());
    ws.on('error', (err) => console.error('[ws] error de conexión:', err.message));
  });

  // Detecta conexiones muertas (wifi caído, pestaña congelada) para liberar asientos.
  const latido = setInterval(() => {
    for (const ws of wss.clients) {
      if (!vivos.has(ws)) {
        ws.terminate();
        continue;
      }
      vivos.delete(ws);
      ws.ping();
    }
  }, LATIDO_MS);
  http.on('close', () => {
    clearInterval(latido);
    wss.close();
  });

  return http;
}
