// Aventuras disponibles para `npm run seed -- <id>`.
import type { SemillaCampana } from '../semilla.ts';
import { molino } from './molino.ts';
import { cripta } from './cripta.ts';
import { feria } from './feria.ts';
import { rey } from './rey.ts';

export const AVENTURAS: Readonly<Record<string, SemillaCampana>> = Object.fromEntries(
  [molino, cripta, feria, rey].map((a) => [a.id, a]),
);
