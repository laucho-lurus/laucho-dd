import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { Gestor } from './gestor.ts';

const INDEX = new URL('../../public/index.html', import.meta.url);
const MAX_MENSAJE_BYTES = 16 * 1024;
const LATIDO_MS = 30_000;

/** Servidor HTTP que sirve public/index.html y acepta WebSockets en /ws. */
export function crearServidor(gestor: Gestor): Server {
  const http = createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      try {
        const html = await readFile(INDEX);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      } catch (err) {
        console.error('[http] no se pudo leer index.html:', err);
        res.writeHead(500).end('Error interno');
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/salud') {
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
