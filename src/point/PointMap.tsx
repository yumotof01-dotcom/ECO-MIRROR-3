import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { HALF, localProjection, wrapLongitude, type Point } from './geometry.ts';

const embedKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY?.trim();

export function PointMap({ point, onPick }: { point: Point | null; onPick: (point: Point) => void }) {
  const [google, setGoogle] = useState(Boolean(embedKey));
  const [satellite, setSatellite] = useState(true);
  const center = point ?? { lat: 35.738, lon: 139.599 };
  const coordinates = `${center.lat},${center.lon}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
  const parameters = embedKey ? new URLSearchParams({
    key: embedKey, q: coordinates, zoom: point ? '16' : '12', maptype: satellite ? 'satellite' : 'roadmap',
    language: 'ja'
  }) : null;

  return <>
    <div className="point-map-tools">
      {embedKey && <>
        <button type="button" aria-pressed={google} onClick={() => setGoogle(true)}>Google マップ</button>
        <button type="button" aria-pressed={!google} onClick={() => setGoogle(false)}>解析地点を選ぶ</button>
      </>}
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Google マップで開く</a>
    </div>
    {google && parameters ? <>
      <p>Google マップで周辺を確認できます。調査地点を指定するときは「解析地点を選ぶ」を押してください。</p>
      <button type="button" aria-pressed={satellite} onClick={() => setSatellite(!satellite)}>航空写真</button>
      <iframe className="point-picker-map point-google-embed" title="Google マップで調査範囲の周辺を見る"
        referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
        src={`https://www.google.com/maps/embed/v1/place?${parameters}`} />
    </> : <SelectionMap point={point} onPick={onPick} />}
  </>;
}

function SelectionMap({ point, onPick }: { point: Point | null; onPick: (point: Point) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const selection = useRef<L.LayerGroup | null>(null);
  const locationLayer = useRef<L.LayerGroup | null>(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [mapError, setMapError] = useState(false);
  const pick = useRef(onPick);

  function locate() {
    const view = map.current;
    if (!view || !navigator.geolocation) {
      setLocationStatus('現在地を取得できません。地図や座標入力で調査地点を選べます。');
      return;
    }
    setLocating(true);
    setLocationStatus('現在地を確認中…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (map.current !== view) return;
      const position = L.latLng(coords.latitude, coords.longitude);
      locationLayer.current?.clearLayers();
      const layer = locationLayer.current;
      if (layer) {
        L.circle(position, { radius: coords.accuracy, color: '#125fb2', weight: 1, fillOpacity: .12, interactive: false }).addTo(layer);
        L.circleMarker(position, { color: '#fff', weight: 3, fillColor: '#125fb2', fillOpacity: 1, radius: 9, interactive: false })
          .bindTooltip('現在地', { permanent: true, direction: 'right' }).addTo(layer);
      }
      view.setView(position, Math.max(view.getZoom(), 15));
      setLocationStatus('青い丸が現在地です。調べる場所は地図を押して選んでください。');
      setLocating(false);
    }, error => {
      if (map.current !== view) return;
      setLocationStatus(error.code === 1
        ? '位置情報の利用が許可されていません。端末の設定を確認するか、地図で場所を選んでください。'
        : '現在地を確認できませんでした。再試行するか、地図で場所を選んでください。');
      setLocating(false);
    }, { timeout: 10000, maximumAge: 30000 });
  }
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { maxBounds: [[-85.05, -540], [85.05, 540]], minZoom: 2, scrollWheelZoom: false })
      .setView([35.738, 139.599], 12);
    map.current = view;
    selection.current = L.layerGroup().addTo(view);
    locationLayer.current = L.layerGroup().addTo(view);
    L.control.scale({ imperial: false }).addTo(view);
    L.tileLayer(import.meta.env.VITE_POINT_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on('tileerror', () => setMapError(true)).on('load', (event: L.LeafletEvent) => {
      const images = (event.target as L.TileLayer).getContainer()?.querySelectorAll('img');
      setMapError(Boolean(images?.length && !Array.from(images).some(img => img.naturalWidth > 0)));
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
    L.polygon(outline, { interactive: false, color: '#fff', weight: 7, fill: false }).addTo(layer);
    L.polygon(outline, { interactive: false, color: '#9e4219', weight: 3, fillOpacity: .12 }).addTo(layer);
    L.circleMarker([point.lat, nearestLongitude], { interactive: false, radius: 6, color: '#fff', fillColor: '#9e4219', fillOpacity: 1 }).bindTooltip('調査地点', { permanent: true, direction: 'top' }).addTo(layer);
    if (!view.getBounds().contains([point.lat, nearestLongitude])) view.setView([point.lat, nearestLongitude], 12);
  }, [point]);

  return <>
    <div className="point-map-tools">
      <button type="button" onClick={locate} disabled={locating}>現在地を表示</button>
      <button type="button" onClick={() => map.current?.setView([15, 0], 2)}>世界全体</button>
      <span><b className="point-current-key">●</b> 現在地　<b className="point-selection-key">■</b> 調査範囲</span>
    </div>
    {locationStatus && <p role="status">{locationStatus}</p>}
    <div ref={host} className="point-picker-map" aria-label="解析地点を選ぶ世界地図" />
    {mapError && <p role="status">背景地図の一部を表示できません。地図を動かして再取得するか、下の座標入力を使ってください。</p>}
  </>;
}
