/** Integer degrees * 1e7, offset +90/+180 degrees on the USB/RF/storage wire. */
export type PositionConfig = Readonly<{
  share: boolean;
  source: 0 | 1;
  latitude: number;
  longitude: number;
}>;
export type PositionReport = Readonly<{
  source: 1;
  latitude: number;
  longitude: number;
  ageMs: number;
}>;
export function validCoordinates(latitude: number, longitude: number) {
  return (
    Number.isInteger(latitude) &&
    latitude >= 0 &&
    latitude <= 1800000000 &&
    Number.isInteger(longitude) &&
    longitude >= 0 &&
    longitude <= 3600000000
  );
}
export function validPosition(value: PositionConfig) {
  return (
    typeof value.share === 'boolean' &&
    (value.source === 0 || value.source === 1) &&
    validCoordinates(value.latitude, value.longitude)
  );
}
export function positionFields(value?: PositionConfig) {
  return value
    ? {
        shareLocation: Number(value.share),
        positionSource: value.source,
        latitude: value.latitude,
        longitude: value.longitude,
      }
    : {};
}
export function readPosition(value: {
  shareLocation?: number;
  positionSource?: number;
  latitude?: number;
  longitude?: number;
}): PositionConfig | undefined {
  const { shareLocation, positionSource, latitude, longitude } = value;
  if ([shareLocation, positionSource, latitude, longitude].every(v => v === undefined)) return;
  if (
    shareLocation === undefined ||
    positionSource === undefined ||
    latitude === undefined ||
    longitude === undefined ||
    shareLocation > 1 ||
    shareLocation < 0 ||
    !Number.isInteger(shareLocation) ||
    (positionSource !== 0 && positionSource !== 1) ||
    !validCoordinates(latitude, longitude)
  )
    throw new Error('invalid position settings');
  return { share: !!shareLocation, source: positionSource, latitude, longitude };
}
/** Input is explicit user-entered decimal degrees, never browser geolocation. */
export function coordinate(value: string, limit: 90 | 180): number {
  if (!/^[+-]?(?:\d+(?:\.\d{1,7})?|\.\d{1,7})$/.test(value.trim()))
    throw new Error('Enter coordinates with up to seven decimal places.');
  const number = Number(value);
  if (!Number.isFinite(number) || number < -limit || number > limit)
    throw new Error('Coordinate is outside its allowed range.');
  return Math.round(number * 10000000) + limit * 10000000;
}
export function degrees(value: number, limit: 90 | 180) {
  return ((value - limit * 10000000) / 10000000).toFixed(7);
}
