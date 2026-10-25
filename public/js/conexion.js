// Conexión WebSocket con el servidor de salas.

/** Abre la conexión y llama a `alRecibir(mensaje)` por cada mensaje del servidor. */
export function conectar(alRecibir, alCerrar) {
  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocolo}://${location.host}/ws`);
  const pendientes = [];
  ws.onopen = () => pendientes.splice(0).forEach((m) => ws.send(m));
  ws.onmessage = ({ data }) => alRecibir(JSON.parse(data));
  ws.onclose = alCerrar;
  return {
    enviar(mensaje) {
      const crudo = JSON.stringify(mensaje);
      if (ws.readyState === WebSocket.OPEN) ws.send(crudo);
      else pendientes.push(crudo);
    },
  };
}
