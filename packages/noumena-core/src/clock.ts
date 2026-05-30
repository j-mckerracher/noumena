export interface Clock {
  now(): Date;
  isoNow(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
};

export function fixedClock(iso: string): Clock {
  return {
    now: () => new Date(iso),
    isoNow: () => iso,
  };
}
