const DISCORD_EPOCH = 1420070400000n;

/** Creation time of a Discord snowflake id. */
export function snowflakeToDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export function daysSince(date: Date | string, now = Date.now()): number {
  const t = typeof date === 'string' ? Date.parse(date) : date.getTime();
  return (now - t) / 86_400_000;
}
