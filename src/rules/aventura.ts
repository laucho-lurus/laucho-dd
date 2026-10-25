// Diagrama de una aventura: nodos (escenas) y flechas (salidas posibles).

export const TIPOS_NODO = ['escena', 'decision', 'tirada', 'combate', 'dialogo', 'evento', 'final'] as const;
export type TipoNodo = (typeof TIPOS_NODO)[number];

export interface Nodo {
  id: string;
  tipo: string; // uno de TIPOS_NODO
  titulo: string;
  texto: string; // para leer en voz alta
  notas: string; // secretas del GM
  // Campos del editor (opcionales: las campañas antiguas no los tienen).
  x?: number;
  y?: number;
  chequeo?: string; // tirada: "percepcion", "salvacion_des"…
  cd?: number;
  monstruos?: { srd_clave: string; cantidad: number }[]; // combate
  opciones?: string[]; // decisión
  pnj?: string; // diálogo
  sabe?: string;
  quiere?: string;
  disparador?: { variable: string; valor: boolean | number | string }; // evento
  recompensas?: string; // final
  xp?: number;
}

export interface Flecha {
  desde: string;
  hasta: string;
  etiqueta: string;
  condicion?: string; // texto libre o "variable = valor"
  efectos?: { variable: string; valor: boolean | number | string }[]; // "fijar variable" al recorrerla
}

export interface Diagrama {
  nodos: Nodo[];
  flechas: Flecha[];
}

export type Variables = Record<string, boolean | number | string>;

export const DIAGRAMA_VACIO: Diagrama = { nodos: [], flechas: [] };

export const nodoInicial = (d: Diagrama): Nodo | null => d.nodos[0] ?? null;

export const buscarNodo = (d: Diagrama, id: string | null): Nodo | null => d.nodos.find((n) => n.id === id) ?? null;

export const salidas = (d: Diagrama, id: string | null): Flecha[] => d.flechas.filter((f) => f.desde === id);
