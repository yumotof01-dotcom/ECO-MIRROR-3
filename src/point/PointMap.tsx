import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { HALF, localProjection, wrapLongitude, type Point } from './geometry.ts';

export function PointMap({ point, onPick }: { point: Point | null; onPick: (point: Point) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const selection = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { maxBounds: [[-85.05, -540], [85.05, 540]], minZoom: 2 })
      .setView([35.738, 139.599], 12);
    map.current = view;
    selection.current = L.layerGroup().addTo(view);
    L.tileLayer(import.meta.env.VITE_POINT_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(view);
    view.on('click', (event: L.LeafletMouseEvent) => pick.current({
      lat: event.latlng.lat, lon: wrapLongitude(event.latlng.lng)
    }));
    return () => { view.remove(); map.current = null; selection.current = null; };
  }, []);
  useEffect(() => {
    const layer = selection.current;
    if (!layer) return;
    layer.clearLayers();
    if (!point) return;
    const view = map.current!;
    const nearestLongitude = view.getCenter().lng + wrapLongitude(point.lon - view.getCenter().lng);
    const { toGeographic } = localProjection(point);
    const outline = [[-HALF, HALF], [HALF, HALF], [HALF, -HALF], [-HALF, -HALF]].map(([x, y]) => {
      const [lon, lat] = toGeographic.forward([x!, y!]);
      return L.latLng(lat, nearestLongitude + wrapLongitude(lon - point.lon));
    });
    L.polygon(outline, { interactive: false, color: '#16594b', weight: 2 }).addTo(layer);
    L.circleMarker([point.lat, nearestLongitude], { interactive: false, radius: 6, color: '#fff', fillColor: '#16594b', fillOpacity: 1 }).addTo(layer);
    if (!view.getBounds().contains([point.lat, nearestLongitude])) view.setView([point.lat, nearestLongitude], 12);
  }, [point]);

  return <div ref={host} className="point-picker-map" aria-label="解析地点を選ぶ世界地図" />;
}
