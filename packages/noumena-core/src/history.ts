import { generateId } from "./ids.js";
import { insertHistoryEvent } from "./db.js";
import type { DatabaseType, HistoryEventRecord } from "./db.js";

export function recordHistoryEvent(
  db: DatabaseType,
  event: Omit<HistoryEventRecord, "event_id">,
): void {
  insertHistoryEvent(db, {
    event_id: generateId("evt"),
    ...event,
  });
}
