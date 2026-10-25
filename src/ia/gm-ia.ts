// GM IA: arma el contexto, llama al modelo y ejecuta sus herramientas (máx. 3 vueltas por disparador).
import type Anthropic from '@anthropic-ai/sdk';
import { buscarNodo, salidas, type Diagrama, type Variables } from '../rules/aventura.ts';
import { HABILIDADES } from '../rules/habilidades.ts';
import type { EstadoJugador } from '../server/sala.ts';
import type { Evento } from '../server/repositorio.ts';
import { costo, MODELO_POR_DEFECTO } from './precios.ts';
import type { EstadoGasto, Presupuesto } from './presupuesto.ts';
import type { PerfilGm } from './perfiles.ts';

export const MAX_TOKENS = 500;
export const MAX_VUELTAS = 3;
export const MAX_PG_POR_LLAMADA = 25;
export const MAX_PG_POR_TURNO = 2; // llamadas a aplicar_pg por disparador

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
}

/** Acciones sobre la sala. Devuelven el texto que verá el modelo como resultado. */
export interface Acciones {
  narrar(texto: string): Promise<string>;
  pedirTirada(personajeId: string, tirada: string, cd: number | null, motivo: string | null): Promise<string>;
  avanzarNodo(nodoId: string): Promise<string>;
  fijarVariable(nombre: string, valor: boolean | number | string): Promise<string>;
  aplicarPg(personajeId: string, cantidad: number, motivo: string): Promise<string>;
}

export type Aviso = (nivel: EstadoGasto['nivel'], estado: EstadoGasto) => void;

const REGLAS = `Eres el Game Master de una partida de Dungeons & Dragons 5e (SRD 5.1) que se juega por chat.
Reglas que siempre cumples:
- Respondes siempre en español.
- Narras con la herramienta "narrar", en máximo ~120 palabras por intervención.
- Nunca inventas resultados de dados ni daño. Si una acción tiene un resultado incierto, pide una tirada con "pedir_tirada" y espera su resultado; no la resuelves tú.
- Daño y curación: solo con "aplicar_pg", y solo tras una tirada ya resuelta o una consecuencia clara de la ficción. Nunca inventes una tirada para justificarlo. Máximo 25 PG por llamada y 2 llamadas por intervención. Si la herramienta no está disponible, propón el daño en la narración y lo aplicará el GM humano.
- Solo avanzas a las salidas listadas del nodo actual ("avanzar_nodo") y solo cambias variables que ya existen ("fijar_variable").
- Las notas del nodo y las CD son secretas: no las reveles a los jugadores.
- Respetas las decisiones de los jugadores y les das algo concreto que hacer al final.`;

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'narrar',
    description: 'Publica narración para los jugadores (máx. ~120 palabras).',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
  {
    name: 'pedir_tirada',
    description: 'Pide una tirada a un jugador. "tirada" es una habilidad o salvación (p. ej. "percepcion", "salvacion_des") o una notación como "1d20+2".',
    input_schema: {
      type: 'object',
      properties: {
        jugador: { type: 'string', description: 'personaje_id del jugador' },
        tirada: { type: 'string' },
        cd: { type: 'integer', minimum: 1, maximum: 40 },
        motivo: { type: 'string' },
      },
      required: ['jugador', 'tirada'],
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

/** Mensaje con el estado actual de la partida (cambia en cada llamada). */
export function promptContexto(c: Contexto, disparador: string): string {
  const nodo = buscarNodo(c.campana.diagrama, c.nodo_actual);
  const lineasSalidas = salidas(c.campana.diagrama, c.nodo_actual)
    .map((f) => `- a "${f.hasta}" (${buscarNodo(c.campana.diagrama, f.hasta)?.titulo ?? '?'}): ${f.etiqueta}${f.condicion ? ` [si: ${f.condicion}]` : ''}`);
  const fichas = c.jugadores.map((j) => {
    const car = Object.entries(j.caracteristicas).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ');
    return `- ${j.nombre} (id ${j.personaje_id}): ${j.raza} ${j.clase} ${j.nivel}, PG ${j.pg_actual}/${j.pg_max}${j.inconsciente ? ' INCONSCIENTE' : ''}, CA ${j.ca ?? '?'}, ${car}`;
  });
  return `Campaña: ${c.campana.nombre}. ${c.campana.resumen}

NODO ACTUAL ${nodo ? `"${nodo.id}" (${nodo.tipo}): ${nodo.titulo}
Texto: ${nodo.texto}
Notas secretas: ${nodo.notas || '—'}` : 'ninguno'}
Salidas posibles:
${lineasSalidas.join('\n') || '- ninguna (final)'}

Variables: ${JSON.stringify(c.variables)}

Personajes en la mesa:
${fichas.join('\n') || '- nadie'}

Habilidades válidas para pedir_tirada: ${Object.keys(HABILIDADES).join(', ')}, salvacion_fue/des/con/int/sab/car.

Últimos eventos:
${c.eventos.slice(-20).map(texto).join('\n') || '- (ninguno)'}

QUÉ PASÓ AHORA: ${disparador}`;
}

/** Valida una llamada a herramienta contra el contexto y la ejecuta. Devuelve el texto del resultado. */
async function ejecutar(
  uso: Anthropic.ToolUseBlock, c: Contexto, acciones: Acciones, cuenta: { pg: number },
): Promise<{ texto: string; error: boolean }> {
  const e = uso.input as Record<string, unknown>;
  const falla = (texto: string) => ({ texto, error: true });
  switch (uso.name) {
    case 'narrar':
      if (typeof e.texto !== 'string' || !e.texto.trim()) return falla('Falta el texto');
      return { texto: await acciones.narrar(e.texto.trim()), error: false };
    case 'pedir_tirada': {
      if (!c.jugadores.some((j) => j.personaje_id === e.jugador)) return falla('Ese jugador no está en la mesa; usa un id de la lista');
      if (typeof e.tirada !== 'string') return falla('Falta la tirada');
      const cd = Number.isInteger(e.cd) ? (e.cd as number) : null;
      const motivo = typeof e.motivo === 'string' && e.motivo.trim() ? e.motivo.trim() : null;
      return { texto: await acciones.pedirTirada(e.jugador as string, e.tirada, cd, motivo), error: false };
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

  estadoGasto() {
    return this.presupuesto.estado();
  }

  /**
   * Un disparador (acción, tirada resuelta o "narrar escena"): llama al modelo y ejecuta sus herramientas.
   * `contexto()` se vuelve a pedir en cada vuelta porque las herramientas cambian la sala.
   */
  async turno(contexto: () => Promise<Contexto>, disparador: string, acciones: Acciones, avisar: Aviso): Promise<void> {
    let c = await contexto();
    const cuenta = { pg: 0 };
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
      // Si contestó en texto plano en vez de usar "narrar", lo publicamos igual.
      const suelto = respuesta.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (usos.length === 0) {
        if (suelto) await acciones.narrar(suelto);
        return;
      }
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      let soloNarro = true;
      for (const uso of usos) {
        const r = await ejecutar(uso, c, acciones, cuenta);
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: r.texto, ...(r.error && { is_error: true }) });
        soloNarro &&= uso.name === 'narrar' && !r.error;
      }
      // Ya habló a los jugadores: otra vuelta solo serviría para repetirse (y gastar).
      if (respuesta.stop_reason !== 'tool_use' || soloNarro) return;
      mensajes.push({ role: 'assistant', content: respuesta.content }, { role: 'user', content: resultados });
      c = await contexto();
    }
  }
}
