// Chat de mesa: charla entre jugadores y GM, aparte de la narración. No gasta turno ni despierta a la IA.

const $ = (id) => document.getElementById(id);
let noLeidos = 0;

const visible = () => !$('chat').hidden;

function marcarNoLeidos() {
  $('no-leidos').hidden = noLeidos === 0;
  $('no-leidos').textContent = noLeidos;
}

/** Añade un mensaje. `deHistorial`: los mensajes viejos no cuentan como no leídos. */
export function agregarChat(evento, deHistorial = false) {
  const d = evento.datos;
  const li = document.createElement('li');
  const autor = document.createElement('span');
  autor.className = 'autor';
  autor.textContent = d.personaje_nombre ?? 'GM';
  const texto = document.createElement('span');
  texto.className = d.en_personaje ? 'en-personaje' : 'fuera';
  texto.textContent = d.en_personaje ? `«${d.texto}»` : `(${d.texto})`;
  li.append(autor, texto);
  $('chat-mensajes').append(li);
  $('chat-mensajes').scrollTop = $('chat-mensajes').scrollHeight;
  if (!deHistorial && !visible()) {
    noLeidos += 1;
    marcarNoLeidos();
  }
}

function mostrarPestana(nombre) {
  for (const b of document.querySelectorAll('[data-pestana]')) b.classList.toggle('activa', b.dataset.pestana === nombre);
  $('ficha').hidden = nombre !== 'ficha';
  $('chat').hidden = nombre !== 'chat';
  if (nombre === 'chat') {
    noLeidos = 0;
    marcarNoLeidos();
    $('chat-texto').focus();
  }
}

/** Conecta la pestaña y el formulario. `enviar(mensaje)` manda por el WebSocket. */
export function iniciarChat(enviar) {
  for (const b of document.querySelectorAll('[data-pestana]')) b.addEventListener('click', () => mostrarPestana(b.dataset.pestana));
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = $('chat-texto').value.trim();
    if (!texto) return;
    enviar({ tipo: 'chat', texto, en_personaje: $('chat-modo').value === 'en' });
    $('chat-texto').value = '';
  });
}
