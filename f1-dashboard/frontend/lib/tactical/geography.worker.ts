import { alignTrack, type CircuitGeometry, type Point } from './geography'
self.onmessage = (event: MessageEvent<{ points: Point[]; circuit: CircuitGeometry }>) => {
  try { self.postMessage({ alignment: alignTrack(event.data.points,event.data.circuit) }) }
  catch { self.postMessage({ error: 'Unable to align the recorded track with geographic reference data.' }) }
}
