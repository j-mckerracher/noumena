import * as fs from "node:fs";
import * as path from "node:path";
import { insertReview, writeReviewDiff } from "./db.js";
import type { DatabaseType, ReviewRecord } from "./db.js";

export function writeReviewJson(
  vaultRoot: string,
  reviewId: string,
  payload: Record<string, unknown>,
): string {
  const rel = `.noumena/reviews/${reviewId}.json`;
  const abs = path.join(vaultRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  return rel;
}

export function storeReview(
  db: DatabaseType,
  vaultRoot: string,
  review: ReviewRecord,
  reviewPayload: Record<string, unknown>,
  diffText: string,
): { reviewJsonPath: string; diffPath: string } {
  const reviewJsonPath = writeReviewJson(vaultRoot, review.review_id, reviewPayload);
  const diffPath = writeReviewDiff(vaultRoot, review.review_id, diffText);
  insertReview(db, { ...review, review_json_path: reviewJsonPath, diff_path: diffPath });
  return { reviewJsonPath, diffPath };
}
