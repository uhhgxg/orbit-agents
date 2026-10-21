/**
 * @orbit-agents/shared
 *
 * Shared business logic for Orbit Agent.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { CraftAgent } from '@orbit-agents/shared/agent';
 *   import { loadStoredConfig } from '@orbit-agents/shared/config';
 *   import { getCredentialManager } from '@orbit-agents/shared/credentials';
 *   import { CraftMcpClient } from '@orbit-agents/shared/mcp';
 *   import { debug } from '@orbit-agents/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@orbit-agents/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@orbit-agents/shared/workspaces';
 *
 * Available modules:
 *   - agent: CraftAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
