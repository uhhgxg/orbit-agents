/**
 * IOAuthFlowStore — abstract interface for the pending OAuth flow store.
 *
 * Handlers program against this; concrete implementations satisfy it.
 * See OAuthFlowStore in @orbit-agents/shared/auth for the canonical impl.
 */

import type { PendingOAuthFlow } from '@orbit-agents/shared/auth'

export interface IOAuthFlowStore {
  store(flow: PendingOAuthFlow): void
  getByState(state: string): PendingOAuthFlow | null
  remove(state: string): void
}
