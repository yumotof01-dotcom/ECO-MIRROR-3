import proj4 from 'proj4';

export interface Point { lat: number; lon: number }
export const SIZE = 200;
export const CELL_METRES = 10;
export const HALF = SIZE * CELL_METRES / 2;

export function wrapLongitude(lon: number) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

export function worldCoverTile(lat: number, lon: number) {
  const south = Math.floor(lat / 3) * 3;
  const west = Math.floor(wrapLongitude(lon) / 3) * 3;
  return `${south < 0 ? 'S' : 'N'}${String(Math.abs(south)).padStart(2, '0')}${west < 0 ? 'W' : 'E'}${String(Math.abs(west)).padStart(3, '0')}`;
}

export function localProjection(point: Point) {
  if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180) {
    throw new Error('緯度と経度の範囲を確認してください。');
  }
  const definition = `+proj=laea +lat_0=${point.lat} +lon_0=${point.lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
  return { definition, toGeographic: proj4(definition, 'EPSG:4326') };
}
