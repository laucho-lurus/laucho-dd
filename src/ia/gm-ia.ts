// GM IA: arma el contexto, llama al modelo y ejecuta sus herramientas (máx. 3 vueltas por disparador).
import type Anthropic from '@anthropic-ai/sdk';
import { buscarNodo, salidas, type Diagrama, type Nodo, type Variables } from '../rules/aventura.ts';
import { esChequeo, HABILIDADES } from '../rules/habilidades.ts';
import { MIN_MOTIVO, motivoPorDefecto, motivoValido } from '../rules/tiradas.ts';
import { estadoMonstruo, MAX_MONSTRUOS_VIVOS, type Monstruo } from '../rules/monstruos.ts';
import type { EstadoJugador } from '../server/sala.ts';
import type { Evento } from '../server/repositorio.ts';
import { costo, MODELO_POR_DEFECTO } from './precios.ts';
import type { EstadoGasto, Presupuesto } from './presupuesto.ts';
import type { PerfilGm } from './perfiles.ts';
import { limiteIa, REGALABLES_IA } from '../rules/items.ts';

export const MAX_TOKENS = 500;
export const MAX_VUELTAS = 3;
export const MAX_PG_POR_LLAMADA = 25;
export const MAX_PG_POR_TURNO = 2; // llamadas a aplicar_pg por disparador
export const MAX_TOKENS_INTRODUCCION = 300;

/** Lo único que usamos del SDK: así los tests inyectan un cliente falso. */
export interface ClienteIa {
  crear(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface Contexto {
  perfil: PerfilGm;
  campana: { nombre: string; resumen: string; diagrama: Diagrama };
  nodo_actual: string | null;
  variables: Variables;
  jugadores: EstadoJugador[];
  eventos: Evento[];
  permitir_pg: boolean; // casilla del GM humano
  introduccion: string | null; // ya leída a los jugadores, con sus nombres
  monstruos: Monstruo[];
  criaturas: { srd_clave: string; nombre: string }[]; // las que se pueden sacar
  turno_de: string | null;
  ronda: number;
}

/** Para qué sirve una tirada pedida contra un monstruo. */
export interface Objetivo {
  objetivo_monstruo: string | null;
  efecto: 'ataque' | 'daño' | null;
}

/** Acciones sobre la sala. Devuelven el texto que verá el modelo como resultado. */
export interface Acciones {
  narrar(texto: string): Promise<string>;
  pedirTirada(personajeId: string, tirada: string, cd: number | null, motivo: string | null, objetivo: Objetivo): Promise<string>;
  agregarMonstruos(srdClave: string, cantidad: number): Promise<string>;
  avanzarNodo(nodoId: string): Promise<string>;
  fijarVariable(nombre: string, valor: boolean | number | string): Promise<string>;
  aplicarPg(personajeId: string, cantidad: number, motivo: string): Promise<string>;
  otorgarItem(personajeId: string, itemId: string, cantidad: number, motivo: string): Promise<string>;
  pasarTurno(objetivo: string | null): Promise<string>;
  otorgarXp(personajeId: string | null, cantidad: number, motivo: string): Promise<string>;
}

export type Aviso = (nivel: EstadoGasto['nivel'], estado: EstadoGasto) => void;

export const MAX_XP_IA = 100;

const REGLAS = `Eres el Game Master de una partida de Dungeons & Dragons 5e (SRD 5.1) que se juega por chat.
Reglas que siempre cumples:
- Respondes siempre en español.
- Narras con la herramienta "narrar", en máximo ~120 palabras por intervención.
- Nunca inventas resultados de dados ni daño. Si una acción tiene un resultado incierto, pide una tirada con "pedir_tirada" y espera su resultado; no la resuelves tú.
- Monstruos: sácalos con "agregar_monstruos". Para que un personaje los ataque, usa "pedir_tirada" con objetivo_monstruo y efecto "ataque" (el servidor usa su CA y te dirá si acierta); si acierta, pide el daño con efecto "daño" y el servidor restará sus PG y te dirá si cae. Nunca inventes ni cambies los PG de un monstruo.
- Daño y curación a personajes: solo con "aplicar_pg", y solo tras una tirada ya resuelta o una consecuencia clara de la ficción. Nunca inventes una tirada para justificarlo. Máximo 25 PG por llamada y 2 llamadas por intervención. Si la herramienta no está disponible, propón el daño en la narración y lo aplicará el GM humano.
- Objetos: solo con "otorgar_item", como recompensa clara de la ficción (un cofre, un pago, un botín). Un objeto por intervención; nada de objetos mágicos poderosos ni oro desmedido.
- Los monstruos atacan solos en su turno: el servidor tira y aplica el daño. Nunca inventes ni repitas ese daño; narra el resultado que te llega. Un personaje a 0 PG está inconsciente y tira salvaciones de muerte solo.
- Turnos: cuando la acción del jugador que tiene el turno queda resuelta (sin tiradas pendientes), llama a "pasar_turno" y di quién sigue. Si te escribe alguien sin turno, recuérdale amablemente de quién es el turno.
- Los hechizos los lanza el jugador con el botón de su ficha: el servidor valida que lo conozca, descuenta el maná (PM), tira y te manda el resultado para que lo narres. Si un jugador dice que lanza un hechizo por chat, pídele que use el botón; si no lo tiene en su lista, niégalo.
- Cada personaje solo puede usar lo que figura en su ficha (armas, objetos, habilidades, hechizos). Si alguien intenta lanzar un hechizo, usar un objeto o una habilidad que no tiene, niégalo dentro de la ficción ("buscas en tu mochila, pero no hay ninguna poción") y no lo resuelvas.
- Solo avanzas a las salidas listadas del nodo actual ("avanzar_nodo") y solo cambias variables que ya existen ("fijar_variable").
- Las notas del nodo y las CD son secretas: no las reveles a los jugadores.
- Respetas las decisiones de los jugadores y les das algo concreto que hacer al final.
- Nunca escribas texto fuera de las herramientas; no confirmes lo que acabas de hacer; narra una sola vez por intervención.
- Al pedir una tirada, di siempre para qué es en "motivo" y termina tu intervención: narrarás el resultado cuando llegue.
- Cuando recibas el resultado de una tirada: (a) narra la consecuencia concreta usando solo el número y el éxito o fracaso que te da el servidor, sin inventar cifras de daño ni PG de monstruos; (b) si fue un ataque exitoso y falta el daño, pide la tirada de daño con su motivo; (c) termina diciendo de forma explícita quién actúa a continuación o qué debe hacer el jugador ("Brisa, tu turno ha terminado: sigue Torvald" / "Brisa, escribe tu siguiente acción").
- Los mensajes "[chat de mesa]" son de los jugadores entre sí: tenlos en cuenta como contexto, pero no necesitan respuesta.`;

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'narrar',
    description: 'Publica narración para los jugadores (máx. ~120 palabras).',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
  {
    name: 'pedir_tirada',
    description: 'Pide una tirada a un jugador. "tirada" es una habilidad o salvación (p. ej. "percepcion", "salvacion_des") o una notación como "1d20+5" o "1d8+3". "motivo" dice para qué es, de forma concreta: "Ataque con arco al kobold más cercano", "Daño del estoque al kobold herido", "Salvación de DES contra la trampa".',
    input_schema: {
      type: 'object',
      properties: {
        jugador: { type: 'string', description: 'personaje_id del jugador' },
        tirada: { type: 'string' },
        cd: { type: 'integer', minimum: 1, maximum: 40 },
        motivo: { type: 'string', minLength: MIN_MOTIVO, description: 'Para qué es la tirada, concreto (mín. 8 caracteres)' },
        objetivo_monstruo: { type: 'string', description: 'id del monstruo (p. ej. "m2") si la tirada es contra él' },
        efecto: { type: 'string', enum: ['ataque', 'daño'], description: '"ataque": el servidor usa la CA del monstruo como CD. "daño": el servidor resta el total a sus PG.' },
      },
      required: ['jugador', 'tirada', 'motivo'],
    },
  },
  {
    name: 'agregar_monstruos',
    description: `Saca monstruos al encuentro (máx. ${MAX_MONSTRUOS_VIVOS} vivos a la vez). Sus PG los lleva el servidor.`,
    input_schema: {
      type: 'object',
      properties: { srd_clave: { type: 'string' }, cantidad: { type: 'integer', minimum: 1, maximum: MAX_MONSTRUOS_VIVOS } },
      required: ['srd_clave', 'cantidad'],
    },
  },
  {
    name: 'aplicar_pg',
    description: 'Aplica daño (cantidad negativa) o curación (positiva) a un personaje de la mesa. Máx. 25 por llamada.',
    input_schema: {
      type: 'object',
      properties: {
        personaje: { type: 'string', description: 'personaje_id' },
        cantidad: { type: 'integer', minimum: -MAX_PG_POR_LLAMADA, maximum: MAX_PG_POR_LLAMADA },
        motivo: { type: 'string', description: 'p. ej. "mordisco del lobo"' },
      },
      required: ['personaje', 'cantidad', 'motivo'],
    },
  },
  {
    name: 'otorgar_xp',
    description: `Da experiencia por algo que no sea matar monstruos (eso lo reparte el servidor al terminar el combate): resolver un enigma, negociar, cumplir una misión. 1 por intervención, máx. ${MAX_XP_IA} por personaje.`,
    input_schema: {
      type: 'object',
      properties: {
        personaje: { type: 'string', description: 'personaje_id; omítelo para dárselo a todos' },
        cantidad: { type: 'integer', minimum: 1, maximum: MAX_XP_IA },
        motivo: { type: 'string' },
      },
      required: ['cantidad', 'motivo'],
    },
  },
  {
    name: 'pasar_turno',
    description: 'Da el turno al siguiente del orden. Si le toca a un monstruo, el servidor resuelve su ataque (tirada, daño y caída) y te devuelve el resultado para que lo narres. Úsala cuando la acción del que tiene el turno quede resuelta.',
    input_schema: {
      type: 'object',
      properties: { objetivo: { type: 'string', description: 'opcional: personaje_id al que atacará el próximo monstruo' } },
    },
  },
  {
    name: 'otorgar_item',
    description: `Da un objeto del catálogo a un personaje (1 por intervención). Máx.: 50 monedas de oro, 2 pociones, 1 de lo demás.`,
    input_schema: {
      type: 'object',
      properties: {
        personaje: { type: 'string', description: 'personaje_id' },
        item_id: { type: 'string', enum: REGALABLES_IA },
        cantidad: { type: 'integer', minimum: 1, maximum: 50 },
        motivo: { type: 'string', description: 'p. ej. "botín del cofre del molinero"' },
      },
      required: ['personaje', 'item_id', 'motivo'],
    },
  },
  {
    name: 'avanzar_nodo',
    description: 'Mueve la aventura a otro nodo. Solo a una salida válida del nodo actual.',
    input_schema: { type: 'object', properties: { nodo_id: { type: 'string' } }, required: ['nodo_id'] },
  },
  {
    name: 'fijar_variable',
    description: 'Cambia el valor de una variable existente de la campaña.',
    input_schema: {
      type: 'object',
      properties: { nombre: { type: 'string' }, valor: { type: ['boolean', 'number', 'string'] } },
      required: ['nombre', 'valor'],
    },
  },
];

const DIFICULTAD: Record<PerfilGm['dificultad'], string> = {
  relajada: 'Dificultad relajada: CD bajas (8–12), enemigos que dudan, segundas oportunidades.',
  normal: 'Dificultad normal: CD estándar (10–15).',
  dura: 'Dificultad dura: CD altas (13–18), enemigos tácticos, consecuencias reales.',
};

/** Prompt de sistema: estable por sala (reglas + perfil), así se puede cachear. */
export function promptSistema(perfil: PerfilGm): string {
  return `${REGLAS}

Tu estilo: ${perfil.nombre} — ${perfil.descripcion}
Tono: ${perfil.tono}
${DIFICULTAD[perfil.dificultad]}`;
}

const texto = (e: Evento) => {
  const d = e.datos as Record<string, unknown>;
  const quien = (d.personaje_nombre as string) ?? e.autor;
  if (e.tipo === 'tirada') return `${quien} tiró ${d.notation}${d.motivo ? ` (${d.motivo})` : ''}: ${d.total}${d.exito === true ? ' — éxito' : d.exito === false ? ' — fracaso' : ''}`;
  if (d.texto) return `${quien}: ${d.texto}`;
  return `[${d.cambio ?? e.tipo}]`;
};

/** Lo que el editor configuró en el nodo (tirada, combate, diálogo…). La CD es secreta para los jugadores. */
function detallesNodo(n: Nodo): string {
  const lineas: string[] = [];
  if (n.chequeo || n.cd) lineas.push(`Tirada configurada: ${n.chequeo ?? 'a elegir'}${n.cd ? `, CD ${n.cd} (secreta: no la digas)` : ''}. Pídela con pedir_tirada.`);
  if (n.monstruos?.length) lineas.push(`Combate configurado: ${n.monstruos.map((m) => `${m.cantidad} × ${m.srd_clave}`).join(', ')} (el servidor ya los sacó al entrar).`);
  if (n.opciones?.length) lineas.push(`Opciones: ${n.opciones.join(' / ')}`);
  if (n.pnj) lineas.push(`PNJ: ${n.pnj}. Sabe: ${n.sabe || '—'}. Quiere: ${n.quiere || '—'}.`);
  if (n.disparador) lineas.push(`Se dispara si ${n.disparador.variable} = ${n.disparador.valor}.`);
  if (n.recompensas || n.xp) lineas.push(`Recompensas: ${n.recompensas || '—'}${n.xp ? `; XP ${n.xp}` : ''}.`);
  return lineas.length ? `\n${lineas.join('\n')}` : '';
}

/** Mensaje con el estado actual de la partida (cambia en cada llamada). */
export function promptContexto(c: Contexto, disparador: string): string {
  const nodo = buscarNodo(c.campana.diagrama, c.nodo_actual);
  const lineasSalidas = salidas(c.campana.diagrama, c.nodo_actual)
    .map((f) => `- a "${f.hasta}" (${buscarNodo(c.campana.diagrama, f.hasta)?.titulo ?? '?'}): ${f.etiqueta}${f.condicion ? ` [si: ${f.condicion}]` : ''}`);
  const fichas = c.jugadores.map((j) => {
    const car = Object.entries(j.caracteristicas).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ');
    const armas = j.armas.map((a) => `${a.nombre} ${a.ataque} ${a.dano}`).join('; ') || '—';
    const objetos = j.inventario.map((i) => `${i.nombre}${i.cantidad > 1 ? ` ×${i.cantidad}` : ''}`).join(', ') || 'nada';
    const hechizos = j.hechizos.map((h) => `${h.nombre} (${h.costo} PM)`).join(', ') || 'ninguno';
    const habilidades = j.habilidades.map((h) => `${h.nombre}${h.uso === 'a_voluntad' ? '' : ` (${h.usos_restantes}/${h.usos_max})`}`).join(', ') || 'ninguna';
    return `- ${j.nombre} (id ${j.personaje_id}): ${j.raza} ${j.clase} ${j.nivel}, PG ${j.pg_actual}/${j.pg_max}${j.inconsciente ? ` INCONSCIENTE${j.muerte ? ` (salvaciones: ${j.muerte.exitos} éxitos, ${j.muerte.fallos} fallos${j.muerte.estable ? ', estable' : ''}${j.muerte.muerto ? ', MUERTO' : ''})` : ''}` : ''}, CA ${j.ca ?? '?'}, ${car}
  Armas: ${armas}. Objetos: ${objetos}. Habilidades: ${habilidades}. Hechizos: ${hechizos}.${j.pm_max ? ` PM ${j.pm}/${j.pm_max}.` : ''} XP ${j.xp}.`;
  });
  return `Campaña: ${c.campana.nombre}. ${c.campana.resumen}
${c.introduccion ? `\nIntroducción (ya leída a los jugadores; no la repitas ni la contradigas): ${c.introduccion}\n` : ''}
NODO ACTUAL ${nodo ? `"${nodo.id}" (${nodo.tipo}): ${nodo.titulo}
Texto: ${nodo.texto}
Notas secretas: ${nodo.notas || '—'}${detallesNodo(nodo)}` : 'ninguno'}
Salidas posibles:
${lineasSalidas.join('\n') || '- ninguna (final)'}

Variables: ${JSON.stringify(c.variables)}

Personajes en la mesa (solo pueden usar lo que figura aquí):
${fichas.join('\n') || '- nadie'}
${c.turno_de ? `Turno de ${c.jugadores.find((j) => j.personaje_id === c.turno_de)?.nombre ?? c.monstruos.find((m) => m.id === c.turno_de)?.nombre ?? '?'} (ronda ${c.ronda}).` : 'Sin orden de turnos.'}

Monstruos (los PG exactos son secretos; a los jugadores descríbeles solo su estado):
${c.monstruos.map((m) => `- ${m.nombre} (id ${m.id}): ${estadoMonstruo(m)}, PG ${m.pg_actual}/${m.pg_max}, CA ${m.ca}, ataques: ${m.ataques.map((a) => `${a.nombre} ${a.ataque} ${a.dano}`).join('; ') || '—'}`).join('\n') || '- ninguno'}
Criaturas que puedes sacar (srd_clave): ${c.criaturas.map((x) => `${x.srd_clave} (${x.nombre})`).join(', ') || '—'}

Habilidades válidas para pedir_tirada: ${Object.keys(HABILIDADES).join(', ')}, salvacion_fue/des/con/int/sab/car.

Últimos eventos:
${c.eventos.filter((e) => e.tipo !== 'chat' && e.tipo !== 'sistema').slice(-20).map(texto).join('\n') || '- (ninguno)'}

Chat de mesa reciente (no necesita respuesta):
${c.eventos.filter((e) => e.tipo === 'chat').slice(-8).map((e) => `[chat de mesa] ${texto(e)}`).join('\n') || '- (vacío)'}

QUÉ PASÓ AHORA: ${disparador}`;
}

/** Valida una llamada a herramienta contra el contexto y la ejecuta. Devuelve el texto del resultado. */
interface Cuenta {
  pg: number;
  narraciones: number;
  motivos_fallidos: number;
  items: number;
  turnos: number;
  xp: number;
}

async function ejecutar(
  uso: Anthropic.ToolUseBlock, c: Contexto, acciones: Acciones, cuenta: Cuenta,
): Promise<{ texto: string; error: boolean }> {
  const e = uso.input as Record<string, unknown>;
  const falla = (texto: string) => ({ texto, error: true });
  switch (uso.name) {
    case 'narrar':
      if (typeof e.texto !== 'string' || !e.texto.trim()) return falla('Falta el texto');
      if (cuenta.narraciones >= 1) return falla('Ya narraste en esta intervención; no repitas');
      cuenta.narraciones += 1;
      return { texto: await acciones.narrar(e.texto.trim()), error: false };
    case 'pedir_tirada': {
      if (!c.jugadores.some((j) => j.personaje_id === e.jugador)) return falla('Ese jugador no está en la mesa; usa un id de la lista');
      if (typeof e.tirada !== 'string') return falla('Falta la tirada');
      const cd = Number.isInteger(e.cd) ? (e.cd as number) : null;
      let motivo = typeof e.motivo === 'string' ? e.motivo.trim() : null;
      // Las habilidades ya traen su nombre ("Percepción"); el resto necesita un propósito claro.
      if (!esChequeo(e.tirada) && !motivoValido(motivo)) {
        if (cuenta.motivos_fallidos === 0) {
          cuenta.motivos_fallidos += 1;
          return falla('Falta un motivo concreto (mín. 8 caracteres), p. ej. "Daño del estoque al kobold herido". Vuelve a pedir la tirada con motivo.');
        }
        motivo = motivoPorDefecto(e.tirada); // segundo intento fallido: no bloqueamos la partida
      }
      const efecto = e.efecto === 'ataque' || e.efecto === 'daño' ? e.efecto : null;
      const objetivo = typeof e.objetivo_monstruo === 'string' && e.objetivo_monstruo ? e.objetivo_monstruo : null;
      // Sin objetivo el servidor no puede restar los PG y el monstruo nunca caería.
      if (efecto && !objetivo && c.monstruos.some((m) => m.pg_actual > 0)) return falla('Para un ataque o daño contra un monstruo indica objetivo_monstruo (su id)');
      if (objetivo) {
        const m = c.monstruos.find((x) => x.id === objetivo);
        if (!m) return falla(`Ese monstruo no existe. Monstruos: ${c.monstruos.map((x) => x.id).join(', ') || 'ninguno'}`);
        if (m.pg_actual <= 0) return falla(`${m.nombre} ya cayó`);
        if (!efecto) return falla('Con objetivo_monstruo indica efecto "ataque" o "daño"');
      }
      return { texto: await acciones.pedirTirada(e.jugador as string, e.tirada, cd, motivo, { objetivo_monstruo: objetivo, efecto: objetivo ? efecto : null }), error: false };
    }
    case 'agregar_monstruos': {
      const n = e.cantidad;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_MONSTRUOS_VIVOS) return falla(`La cantidad va de 1 a ${MAX_MONSTRUOS_VIVOS}`);
      if (typeof e.srd_clave !== 'string' || !c.criaturas.some((x) => x.srd_clave === e.srd_clave)) {
        return falla(`Criatura desconocida. Disponibles: ${c.criaturas.map((x) => x.srd_clave).join(', ')}`);
      }
      return { texto: await acciones.agregarMonstruos(e.srd_clave, n), error: false };
    }
    case 'aplicar_pg': {
      if (!c.permitir_pg) return falla('El GM humano desactivó que apliques daño o curación; propónlo en la narración');
      if (cuenta.pg >= MAX_PG_POR_TURNO) return falla(`Ya aplicaste PG ${MAX_PG_POR_TURNO} veces en esta intervención`);
      if (!c.jugadores.some((j) => j.personaje_id === e.personaje)) return falla('Ese personaje no está en la mesa; usa un id de la lista');
      const n = e.cantidad;
      if (typeof n !== 'number' || !Number.isInteger(n) || n === 0 || Math.abs(n) > MAX_PG_POR_LLAMADA) {
        return falla(`La cantidad debe ser un entero distinto de 0 entre -${MAX_PG_POR_LLAMADA} y ${MAX_PG_POR_LLAMADA}`);
      }
      if (typeof e.motivo !== 'string' || !e.motivo.trim()) return falla('Falta el motivo');
      cuenta.pg += 1;
      return { texto: await acciones.aplicarPg(e.personaje as string, n, e.motivo.trim()), error: false };
    }
    case 'otorgar_xp': {
      if (cuenta.xp >= 1) return falla('Ya diste experiencia en esta intervención');
      const n = e.cantidad;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_XP_IA) return falla(`La cantidad va de 1 a ${MAX_XP_IA}`);
      if (e.personaje !== undefined && !c.jugadores.some((j) => j.personaje_id === e.personaje)) return falla('Ese personaje no está en la mesa; usa un id de la lista');
      if (typeof e.motivo !== 'string' || !e.motivo.trim()) return falla('Falta el motivo');
      cuenta.xp += 1;
      return { texto: await acciones.otorgarXp((e.personaje as string | undefined) ?? null, n, e.motivo.trim()), error: false };
    }
    case 'pasar_turno':
      if (cuenta.turnos >= 1) return falla('Ya pasaste el turno en esta intervención');
      if (e.objetivo !== undefined && !c.jugadores.some((j) => j.personaje_id === e.objetivo)) return falla('Ese objetivo no está en la mesa; usa un id de la lista');
      cuenta.turnos += 1;
      return { texto: await acciones.pasarTurno((e.objetivo as string | undefined) ?? null), error: false };
    case 'otorgar_item': {
      if (cuenta.items >= 1) return falla('Ya diste un objeto en esta intervención');
      if (!c.jugadores.some((j) => j.personaje_id === e.personaje)) return falla('Ese personaje no está en la mesa; usa un id de la lista');
      const tope = typeof e.item_id === 'string' ? limiteIa(e.item_id) : 0;
      if (!tope) return falla('Ese objeto no existe o no puedes darlo; el GM humano decide los objetos poderosos');
      const n = e.cantidad ?? 1;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > tope) return falla(`La cantidad de ese objeto va de 1 a ${tope}`);
      if (typeof e.motivo !== 'string' || !e.motivo.trim()) return falla('Falta el motivo');
      cuenta.items += 1;
      return { texto: await acciones.otorgarItem(e.personaje as string, e.item_id as string, n, e.motivo.trim()), error: false };
    }
    case 'avanzar_nodo': {
      const validas = salidas(c.campana.diagrama, c.nodo_actual).map((f) => f.hasta);
      if (!validas.includes(e.nodo_id as string)) return falla(`Salida inválida. Salidas válidas: ${validas.join(', ') || 'ninguna'}`);
      return { texto: await acciones.avanzarNodo(e.nodo_id as string), error: false };
    }
    case 'fijar_variable': {
      if (typeof e.nombre !== 'string' || !Object.hasOwn(c.variables, e.nombre)) return falla(`Esa variable no existe. Variables: ${Object.keys(c.variables).join(', ')}`);
      if (!['boolean', 'number', 'string'].includes(typeof e.valor)) return falla('Valor inválido');
      return { texto: await acciones.fijarVariable(e.nombre, e.valor as boolean | number | string), error: false };
    }
    default:
      return falla(`Herramienta desconocida: ${uso.name}`);
  }
}

export interface OpcionesGmIa {
  cliente: ClienteIa;
  presupuesto: Presupuesto;
  modelo?: string;
}

export class GmIa {
  private readonly cliente: ClienteIa;
  private readonly presupuesto: Presupuesto;
  readonly modelo: string;

  constructor({ cliente, presupuesto, modelo = MODELO_POR_DEFECTO }: OpcionesGmIa) {
    this.cliente = cliente;
    this.presupuesto = presupuesto;
    this.modelo = modelo;
  }

  /**
   * Escribe una introducción de ambientación (plantilla con {heroes}) para una campaña que no la tiene.
   * Una llamada, sin herramientas y con pocos tokens. Devuelve null si no hay presupuesto o no respondió.
   */
  async generarIntroduccion(perfil: PerfilGm, campana: { nombre: string; resumen: string; primerNodo: string }): Promise<string | null> {
    if ((await this.presupuesto.estado()).nivel === 'agotado') return null;
    const respuesta = await this.cliente.crear({
      model: this.modelo,
      max_tokens: MAX_TOKENS_INTRODUCCION,
      system: [{ type: 'text', text: promptSistema(perfil), cache_control: { type: 'ephemeral' } }],
      thinking: this.modelo.startsWith('claude-sonnet') ? { type: 'between_tools' } : { type: 'disabled' },
      messages: [{
        role: 'user',
        content: `Escribe la introducción de ambientación de la campaña «${campana.nombre}» (${campana.resumen}). La primera escena es: ${campana.primerNodo}.
Entre 3 y 5 frases, en español: un lugar concreto, el encargo que reciben los héroes y un gancho. Escribe literalmente {heroes} donde vayan los nombres de los personajes. Responde solo con el texto, sin títulos ni comillas.`,
      }],
    });
    await this.presupuesto.registrar(costo(this.modelo, respuesta.usage));
    const texto = respuesta.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (!texto) return null;
    return /\{heroes\}/i.test(texto) ? texto : `{heroes}: ${texto}`;
  }

  estadoGasto() {
    return this.presupuesto.estado();
  }

  /**
   * Un disparador (acción, tirada resuelta o "narrar escena"): llama al modelo y ejecuta sus herramientas.
   * `contexto()` se vuelve a pedir en cada vuelta porque las herramientas cambian la sala.
   */
  async turno(contexto: () => Promise<Contexto>, disparador: string, acciones: Acciones, avisar: Aviso): Promise<void> {
    let c = await contexto();
    const cuenta: Cuenta = { pg: 0, narraciones: 0, motivos_fallidos: 0, items: 0, turnos: 0, xp: 0 };
    const herramientas = c.permitir_pg ? HERRAMIENTAS : HERRAMIENTAS.filter((h) => h.name !== 'aplicar_pg');
    const sistema: Anthropic.TextBlockParam[] = [{ type: 'text', text: promptSistema(c.perfil), cache_control: { type: 'ephemeral' } }];
    const mensajes: Anthropic.MessageParam[] = [{ role: 'user', content: promptContexto(c, disparador) }];

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const antes = await this.presupuesto.estado();
      if (antes.nivel === 'agotado') return avisar('agotado', antes);

      const respuesta = await this.cliente.crear({
        model: this.modelo,
        max_tokens: MAX_TOKENS,
        system: sistema,
        tools: herramientas,
        // Respuestas cortas y baratas: sin razonamiento extendido.
        thinking: this.modelo.startsWith('claude-sonnet') ? { type: 'between_tools' } : { type: 'disabled' },
        messages: mensajes,
      });
      const despues = await this.presupuesto.registrar(costo(this.modelo, respuesta.usage));
      if (despues.nivel !== antes.nivel) avisar(despues.nivel, despues);

      const usos = respuesta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (usos.length === 0) {
        // Solo si no usó ninguna herramienta en toda la intervención publicamos su texto suelto;
        // después de herramientas, el texto libre suele ser un "ya lo hice" que repite lo anterior.
        const suelto = respuesta.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (vuelta === 0 && suelto) await acciones.narrar(suelto);
        return;
      }
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      let soloNarro = true;
      let pidioTirada = false;
      for (const uso of usos) {
        const r = await ejecutar(uso, c, acciones, cuenta);
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: r.texto, ...(r.error && { is_error: true }) });
        soloNarro &&= uso.name === 'narrar' && !r.error;
        pidioTirada ||= uso.name === 'pedir_tirada' && !r.error;
      }
      // Ya habló a los jugadores, o espera una tirada (la narración llegará con su resultado):
      // otra vuelta solo serviría para repetirse y gastar.
      if (respuesta.stop_reason !== 'tool_use' || soloNarro || pidioTirada) return;
      mensajes.push({ role: 'assistant', content: respuesta.content }, { role: 'user', content: resultados });
      c = await contexto();
    }
  }
}
