/**
 * Known accessibility findings, so the gate can land green and stay honest.
 *
 * Every entry needs a reason and the number of nodes it is currently allowed to
 * affect. The helper fails on a rule that exceeds its `maxNodes`, so this file
 * cannot silently absorb new breakage - and it prints what it tolerated on every
 * run, because an allowlist nobody reads becomes permanent.
 *
 * Adding an entry is a decision, not a fix: prefer repairing the markup. Each
 * reason below says what the repair is and why it was not done in this commit.
 *
 * @type {Record<string, { reason: string, maxNodes: number }>}
 */
export const ALLOWED_VIOLATIONS = {};
