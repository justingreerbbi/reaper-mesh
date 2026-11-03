export type DiscoveryConfig = Readonly<{ beacon: boolean; respond: boolean; interval: number }>;
export function validDiscovery(value: DiscoveryConfig) {
  return (
    typeof value.beacon === 'boolean' &&
    typeof value.respond === 'boolean' &&
    Number.isInteger(value.interval) &&
    value.interval >= 60 &&
    value.interval <= 3600
  );
}
export function discoveryFields(value?: DiscoveryConfig) {
  return value
    ? {
        beacon: Number(value.beacon),
        respond: Number(value.respond),
        beaconInterval: value.interval,
      }
    : {};
}
