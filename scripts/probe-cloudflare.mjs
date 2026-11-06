/** GitHub Actions only: inspect public Cloudflare deploy output to diagnose blank pages. */
const urls = [
  "https://e0542378.eco-mirror-3.pages.dev/",
  "https://eco-mirror-3.pages.dev/",
  "https://ca35856a.eco-mirror-3.pages.dev/",
  "https://feat-phase1-react-app-shell.eco-mirror-3.pages.dev/",
  "https://c3237a8c.eco-mirror-3.pages.dev/"
];
for (const url of urls) {
  console.log("\nREMOTE_URL", url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "ECO-MIRROR-3-public-site-health-check" } });
    const html = await response.text();
    console.log("HTTP", response.status, "TYPE", response.headers.get("content-type"), "LENGTH", html.length);
    console.log("TITLE", html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "NOT_FOUND");
    console.log("HAS_ROOT", /<div\s+id=["']root["']/.test(html));
    console.log("HAS_UNBUILT_TSX", html.includes('/src/main.tsx'));
    const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m => m[1]);
    console.log("ASSETS", JSON.stringify(assets));
    console.log("HTML_SAMPLE", html.slice(0, 450).replace(/\s+/g, " "));
    const assetStatuses = [];
    for (const asset of assets.slice(0, 4)) {
      const target = new URL(asset, url);
      try {
        const res = await fetch(target, { signal: AbortSignal.timeout(12000) });
        console.log("ASSET", target.href, "HTTP", res.status, "TYPE", res.headers.get('content-type'), "LENGTH", (await res.arrayBuffer()).byteLength);
        assetStatuses.push({ path: asset, ok: res.ok });
      } catch (error) {
        console.log("ASSET_FETCH_ERROR", target.href, String(error));
        assetStatuses.push({ path: asset, ok: false });
      }
    }
    const reactBundleReady = response.ok
      && /<div\s+id=["']root["']/.test(html)
      && !html.includes('/src/main.tsx')
      && assetStatuses.some(({path, ok}) => path.endsWith('.js') && ok)
      && assetStatuses.some(({path, ok}) => path.endsWith('.css') && ok);
    console.log("SITE_RESULT", reactBundleReady ? "BUILT_REACT_ASSETS_ACCESSIBLE" : "DEPLOYED_FILE_OR_ROUTING_MISMATCH");
  } catch (error) {
    console.log("FETCH_ERROR", String(error));
  }
}
