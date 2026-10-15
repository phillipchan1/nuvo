/**
 * The private broadcast topic one account's changes to one table arrive on.
 *
 * The other half is `rt_broadcast()` (migration 90), which routes each row to
 * its owner's topic, and the `realtime.messages` policy, which only lets an
 * account join its own. Change the shape in all three places or nothing
 * arrives. `tests/realtime-broadcast.test.ts` holds them together.
 */
export const LIVE_TOPIC_PREFIX = "nuvo";

export const liveTopic = (userId: string, table: string) => `${LIVE_TOPIC_PREFIX}:${userId}:${table}`;
