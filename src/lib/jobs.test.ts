import { describe, expect, it } from 'vitest'
import type { Job } from '../api'
import { filterCounts, gradientFor, matchesFilter } from './jobs'

const job = (over: Partial<Job>): Job => ({
  id: 1,
  url: 'u',
  title: 't',
  thumbnail: null,
  recipe_id: 'universal',
  recipe_name: 'Universal MP4',
  res: '1080p',
  status: 'downloading',
  progress: 50,
  speed: '—',
  eta: '—',
  location_id: 1,
  dest_display: '/downloads/videos',
  error: null,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('filters', () => {
  const jobs = [
    job({ id: 1, status: 'downloading' }),
    job({ id: 2, status: 'queued' }),
    job({ id: 3, status: 'paused' }),
    job({ id: 4, status: 'completed' }),
    job({ id: 5, status: 'failed' }),
  ]

  it('counts every bucket', () => {
    expect(filterCounts(jobs)).toEqual({ all: 5, active: 3, completed: 1, failed: 1 })
  })

  it('active matches downloading, queued and paused', () => {
    expect(jobs.filter((j) => matchesFilter(j, 'active')).map((j) => j.id)).toEqual([1, 2, 3])
  })
})

describe('gradientFor', () => {
  it('is deterministic and always valid', () => {
    expect(gradientFor(7)).toBe(gradientFor(7))
    expect(gradientFor(123)).toMatch(/linear-gradient/)
  })
})
