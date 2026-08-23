/**
 * LLM gateway module boundary.
 *
 * Kept as a compatibility facade while the legacy implementation is migrated
 * into the llm module incrementally. New application code should import from
 * `modules/llm` rather than the legacy top-level file.
 */
export * from '../../gateway.js';
