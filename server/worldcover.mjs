const tilePattern = /^[NS]\d{2}[EW]\d{3}$/;
const maxRangeBytes = 8 * 1024 * 1024;

export async function forwardWorldCover(request, fetchTile = (url, options) => fetch(url, options)) {
  const tile = new URL(request.url).searchParams.get('tile') ?? '';
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('range') ?? '');
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  if (!tilePattern.test(tile) || !match) return new Response(null, { status: 400 });
  const latitude = Number(tile.slice(1, 3));
  const longitude = Number(tile.slice(4));
  if (latitude > 90 || longitude > 180 || latitude % 3 || longitude % 3 ||
      (latitude === 0 && tile.startsWith('S')) || (longitude === 0 && tile[3] === 'W') ||
      (latitude === 90 && tile.startsWith('N')) || (longitude === 180 && tile[3] === 'E')) {
    return new Response(null, { status: 400 });
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(end) || !Number.isSafeInteger(start) || end < start ||
      end - start >= maxRangeBytes) return new Response(null, { status: 416 });

  const source = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';
  try {
    const response = await fetchTile(source + `ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`, {
      headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
      cache: 'no-store', signal: request.signal, redirect: 'error'
    });
    const contentRange = response.headers.get('Content-Range') ?? '';
    const returned = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (response.status !== 206 || !returned || Number(returned[1]) !== start ||
        Number(returned[2]) !== Math.min(end, Number(returned[3]) - 1)) {
      await response.body?.cancel();
      return new Response(null, {
        status: response.status === 404 ? 404 : 502,
        headers: { 'X-WorldCover-Upstream-Status': String(response.status) }
      });
    }
    return new Response(response.body, {
      status: 206,
      headers: {
        'Content-Type': 'image/tiff',
        'Content-Range': contentRange,
        'Content-Length': String(Number(returned[2]) - start + 1),
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    return new Response(null, {
      status: 502, headers: { 'X-WorldCover-Error': String(error?.message ?? 'fetch failed').replace(/[^ -~]/g, '').slice(0, 160) }
    });
  }
}
