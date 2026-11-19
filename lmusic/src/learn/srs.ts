import type { Word } from '../types'

/** 0 = otra vez, 1 = difícil, 2 = bien, 3 = fácil */
export type Grade = 0 | 1 | 2 | 3

export interface SrsState {
  ease: number
  intervalDays: number
  reps: number
  lapses: number
}

const DAY = 86_400_000
const MIN = 60_000
const round1 = (n: number) => Math.round(n * 10) / 10

export function nextSrs(
  w: Pick<Word, 'ease' | 'intervalDays' | 'reps' | 'lapses' | 'difficult'>,
  g: Grade,
): { state: SrsState; dueInMs: number } {
  let { ease, intervalDays, reps, lapses } = w

  if (g === 0) {
    ease = Math.max(1.3, ease - 0.2)
    lapses += 1
    reps = 0
    intervalDays = 0
    return { state: { ease, intervalDays, reps, lapses }, dueInMs: 10 * MIN }
  }

  if (g === 1) {
    intervalDays = reps === 0 ? 0.5 : Math.max(1, round1(intervalDays * 1.2))
    ease = Math.max(1.3, ease - 0.15)
  } else if (g === 2) {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : round1(intervalDays * ease)
  } else {
    intervalDays = reps === 0 ? 4 : reps === 1 ? 6 : round1(intervalDays * ease * 1.3)
    ease += 0.15
  }
  reps += 1

  // Las palabras marcadas como difíciles vuelven más seguido
  if (w.difficult && intervalDays > 1) intervalDays = Math.max(1, round1(intervalDays * 0.7))

  return { state: { ease, intervalDays, reps, lapses }, dueInMs: intervalDays * DAY }
}

export function intervalLabel(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} h`
  const d = Math.round(ms / DAY)
  return `${d} d`
}

export function isDue(w: Word, now: number): boolean {
  return w.dueAt <= now
}

export function dueLabel(w: Word, now: number): string {
  if (w.dueAt <= now) return w.reps === 0 && w.lastReviewed === 0 ? 'Nueva' : 'Hoy'
  return `En ${intervalLabel(w.dueAt - now)}`
}
