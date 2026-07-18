import type { Job } from '../api'

export type QueueFilter = 'all' | 'active' | 'completed' | 'failed'

export function matchesFilter(job: Job, filter: QueueFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active')
    return job.status === 'downloading' || job.status === 'queued' || job.status === 'paused'
  return job.status === filter
}

export function filterCounts(jobs: Job[]): Record<QueueFilter, number> {
  return {
    all: jobs.length,
    active: jobs.filter((j) => matchesFilter(j, 'active')).length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  }
}

// Deterministic fallback gradient for items without a thumbnail.
const GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#ec4899,#8b5cf6)',
  'linear-gradient(135deg,#3b82f6,#6366f1)',
  'linear-gradient(135deg,#22d3ee,#3b82f6)',
]

export function gradientFor(id: number): string {
  return GRADIENTS[Math.abs(id) % GRADIENTS.length]
}
