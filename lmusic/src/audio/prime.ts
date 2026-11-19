import { useEffect, useState } from 'react'
import { dbAddPrime, dbDeletePrime, dbLoadPrime, dbSetPrimeStars } from '../db/db'
import type { PrimeMoment } from '../db/db'

export type { PrimeMoment }

const cache = new Map<number, PrimeMoment[]>()
const subs = new Set<(trackId: number) => void>()
const notify = (id: number) => subs.forEach((fn) => fn(id))

async function refresh(trackId: number): Promise<PrimeMoment[]> {
  const list = await dbLoadPrime(trackId)
  cache.set(trackId, list)
  notify(trackId)
  return list
}

export async function addPrime(trackId: number, startMs: number, endMs: number, stars = 4): Promise<void> {
  await dbAddPrime(trackId, Math.round(startMs), Math.round(endMs), stars)
  await refresh(trackId)
}

export async function setPrimeStars(trackId: number, id: number, stars: number): Promise<void> {
  await dbSetPrimeStars(id, stars)
  await refresh(trackId)
}

export async function removePrime(trackId: number, id: number): Promise<void> {
  await dbDeletePrime(id)
  await refresh(trackId)
}

/** Momentos prime de una canción: sus partes favoritas, con una intensidad de 1 a 5 estrellas. */
export function usePrime(trackId: number | undefined): PrimeMoment[] {
  const [list, setList] = useState<PrimeMoment[]>(() => (trackId !== undefined ? (cache.get(trackId) ?? []) : []))
  useEffect(() => {
    if (trackId === undefined) return
    let alive = true
    setList(cache.get(trackId) ?? [])
    void (cache.has(trackId) ? Promise.resolve(cache.get(trackId) as PrimeMoment[]) : refresh(trackId)).then((l) => {
      if (alive) setList(l)
    })
    const fn = (id: number) => {
      if (id === trackId && alive) setList(cache.get(id) ?? [])
    }
    subs.add(fn)
    return () => {
      alive = false
      subs.delete(fn)
    }
  }, [trackId])
  return list
}
