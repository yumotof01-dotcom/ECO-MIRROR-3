import { forwardWorldCover } from '../../server/worldcover.mjs';

export function onRequest({ request }) {
  return forwardWorldCover(request);
}
