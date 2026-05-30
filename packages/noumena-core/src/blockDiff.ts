import { canonicalSerializeBlock } from "./canonicalSerializeBlock.js";
import type { NoumenaBlock } from "./types.js";

export interface BlockDiff {
  blockId: string;
  role: string;
  before: string;
  after: string;
}

export function buildBlockDiffs(before: NoumenaBlock[], after: NoumenaBlock[]): BlockDiff[] {
  const afterById = new Map(after.map((block) => [block.blockId, block]));
  const diffs: BlockDiff[] = [];

  for (const oldBlock of before) {
    const newBlock = afterById.get(oldBlock.blockId);
    if (!newBlock) continue;
    const oldHtml = canonicalSerializeBlock(oldBlock).trimEnd();
    const newHtml = canonicalSerializeBlock(newBlock).trimEnd();
    if (oldHtml !== newHtml) {
      diffs.push({
        blockId: oldBlock.blockId,
        role: oldBlock.role,
        before: oldHtml,
        after: newHtml,
      });
    }
  }

  return diffs;
}
