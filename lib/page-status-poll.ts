// Cadência da consulta de status de página pendente (spec 2.5).
// Prazo igual ao REBUILD_TIMEOUT_MS do build.
export const POLL_GIVE_UP_MS = 300_000

const FAST_PHASE_MS = 30_000

// Espera até a próxima consulta, dado o tempo já decorrido. null = desistir.
export function nextPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= POLL_GIVE_UP_MS) return null
  return elapsedMs < FAST_PHASE_MS ? 1000 : 5000
}

// Teto do router.refresh(): intervalo mínimo entre dois e máximo sem o componente desmontar.
export const MIN_REFRESH_GAP_MS = 5000
export const MAX_REFRESHES = 3
