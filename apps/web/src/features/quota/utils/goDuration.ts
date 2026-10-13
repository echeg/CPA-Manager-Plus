export function goDurationSeconds(input: string): number | undefined {
  if (/^[+-]?0$/.test(input)) return 0;
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+$/.test(input)) return undefined;
  const units: Record<string, bigint> = {
    ns: 1n,
    us: 1000n,
    µs: 1000n,
    μs: 1000n,
    ms: 1000000n,
    s: 1000000000n,
    m: 60000000000n,
    h: 3600000000000n,
  };
  let nanos = 0n;
  for (const match of input.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)) {
    const [whole, fraction = ''] = match[1].split('.');
    const unit = units[match[2]];
    nanos += BigInt(whole || '0') * unit;
    if (fraction) nanos += (BigInt(fraction) * unit) / 10n ** BigInt(fraction.length);
  }
  const negative = input.startsWith('-');
  if (nanos > (negative ? 9223372036854775808n : 9223372036854775807n)) return undefined;
  return Number(negative ? -nanos : nanos) / 1e9;
}
