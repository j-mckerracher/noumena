/**
 * Deterministic ID generator for Noumena.
 *
 * ID formats (AC-005 / Phase 1 Implementation Plan §8):
 *   doc_[0-9A-HJKMNP-TV-Z]{26}
 *   blk_[0-9A-HJKMNP-TV-Z]{26}
 *   ev_[0-9A-HJKMNP-TV-Z]{26}
 *   evt_[0-9A-HJKMNP-TV-Z]{26}
 *   note_[0-9A-HJKMNP-TV-Z]{26}
 *
 * Production: monotonic ULID-style generator.
 * Tests: deterministic clock + counter for reproducible fixtures.
 */

/** Crockford Base32 alphabet (ULID-compatible, excludes I, L, O, U). */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;

/** Valid ID prefixes. */
export type IdPrefix = "doc" | "blk" | "ev" | "evt" | "note" | "pat" | "rev";

const RANDOM_LEN = 16; // 16 random chars (80 bits)
const TIME_LEN = 10; // 10 time chars (48 bits, ms since epoch)
const SUFFIX_LEN = TIME_LEN + RANDOM_LEN; // 26

/** Regex for validating a generated ID suffix (26 Crockford Base32 chars). */
const SUFFIX_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Full ID regex per prefix. */
export const ID_PATTERNS: Record<IdPrefix, RegExp> = {
  doc: /^doc_[0-9A-HJKMNP-TV-Z]{26}$/,
  blk: /^blk_[0-9A-HJKMNP-TV-Z]{26}$/,
  ev: /^ev_[0-9A-HJKMNP-TV-Z]{26}$/,
  evt: /^evt_[0-9A-HJKMNP-TV-Z]{26}$/,
  note: /^note_[0-9A-HJKMNP-TV-Z]{26}$/,
  pat: /^pat_[0-9A-HJKMNP-TV-Z]{26}$/,
  rev: /^rev_[0-9A-HJKMNP-TV-Z]{26}$/,
};

/**
 * Encode a 48-bit millisecond timestamp into 10 Crockford Base32 characters.
 * Most significant digit first (big-endian).
 */
function encodeTime(ms: number): string {
  let value = ms;
  const chars: string[] = new Array(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    chars[i] = ENCODING[value % 32]!;
    value = Math.floor(value / 32);
  }
  return chars.join("");
}

/**
 * Generate 16 random Crockford Base32 characters.
 * Uses crypto.getRandomValues when available, Math.random fallback.
 */
function encodeRandom(): string {
  const chars: string[] = new Array(RANDOM_LEN);
  const g = globalThis as Record<string, unknown>;
  const cryptoObj = g["crypto"] as { getRandomValues?: (buf: Uint8Array) => Uint8Array } | undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(RANDOM_LEN);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < RANDOM_LEN; i++) {
      chars[i] = ENCODING[bytes[i]! % 32]!;
    }
  } else {
    for (let i = 0; i < RANDOM_LEN; i++) {
      chars[i] = ENCODING[Math.floor(Math.random() * 32)]!;
    }
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Production generator
// ---------------------------------------------------------------------------

let lastTime = 0;
let lastRandom = "";

/**
 * Generate a monotonic ULID-style ID with the given prefix.
 * If called multiple times within the same millisecond, the random
 * component is incremented to preserve sort order.
 */
export function generateId(prefix: IdPrefix): string {
  const now = Date.now();
  if (now === lastTime) {
    // Increment the last random string to maintain monotonicity
    lastRandom = incrementBase32(lastRandom);
  } else {
    lastTime = now;
    lastRandom = encodeRandom();
  }
  return `${prefix}_${encodeTime(now)}${lastRandom}`;
}

/**
 * Increment a Crockford Base32 string by 1 (rightmost digit).
 * Wraps around on overflow (extremely unlikely with 80 bits).
 */
function incrementBase32(str: string): string {
  const chars = str.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i]!);
    if (idx < 31) {
      chars[i] = ENCODING[idx + 1]!;
      return chars.join("");
    }
    chars[i] = ENCODING[0]!; // wrap and carry
  }
  return chars.join(""); // full overflow (all zeros)
}

// ---------------------------------------------------------------------------
// Deterministic test generator
// ---------------------------------------------------------------------------

export interface TestClock {
  now: number;
  counter: number;
}

/**
 * Create a deterministic test clock starting at the given epoch ms.
 */
export function createTestClock(startMs: number = 1716940800000): TestClock {
  return { now: startMs, counter: 0 };
}

/**
 * Advance the test clock by `ms` milliseconds and reset counter.
 */
export function advanceTestClock(clock: TestClock, ms: number): void {
  clock.now += ms;
  clock.counter = 0;
}

/**
 * Generate a deterministic ID using a test clock.
 * The random portion is derived from the counter (zero-padded Crockford Base32).
 */
export function generateTestId(clock: TestClock, prefix: IdPrefix): string {
  const timePart = encodeTime(clock.now);
  const counterPart = encodeCounter(clock.counter);
  clock.counter++;
  return `${prefix}_${timePart}${counterPart}`;
}

/**
 * Encode a counter value as a zero-padded 16-char Crockford Base32 string.
 */
function encodeCounter(counter: number): string {
  let value = counter;
  const chars: string[] = new Array(RANDOM_LEN).fill(ENCODING[0]!);
  for (let i = RANDOM_LEN - 1; i >= 0 && value > 0; i--) {
    chars[i] = ENCODING[value % 32]!;
    value = Math.floor(value / 32);
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check whether a string matches a valid Noumena ID format.
 */
export function isValidId(id: string, prefix?: IdPrefix): boolean {
  if (prefix) {
    return ID_PATTERNS[prefix].test(id);
  }
  return (Object.values(ID_PATTERNS) as RegExp[]).some((re) => re.test(id));
}
