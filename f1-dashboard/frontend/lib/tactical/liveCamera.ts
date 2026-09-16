/** Local telemetry coordinates only. Never extrapolates beyond a received fix. */
export type LivePose = { x: number; y: number; heading: number }
export type LiveMotion = { from: LivePose; to: LivePose; start: number; duration: number }
export function angleDelta(from: number, to: number) {
  return ((to - from + 540) % 360 + 360) % 360 - 180
}
export function sampleMotion(motion: LiveMotion, now: number): LivePose {
  const t = Math.max(0, Math.min(1, (now - motion.start) / Math.max(1, motion.duration)))
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * t,
    y: motion.from.y + (motion.to.y - motion.from.y) * t,
    heading: motion.from.heading + angleDelta(motion.from.heading, motion.to.heading) * t,
  }
}
export function nextMotion(previous: LiveMotion | undefined, point: { x: number; y: number }, now: number, duration: number): LiveMotion {
  const from = previous ? sampleMotion(previous, now) : { ...point, heading: 0 }
  const dx = point.x - (previous?.to.x ?? point.x)
  const dy = point.y - (previous?.to.y ?? point.y)
  const heading = Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) * 180 / Math.PI : from.heading
  return { from, to: { ...point, heading }, start: now, duration }
}
/** Rotate the target's travel direction to screen-up. Projection already flips Y. */
export function cameraPoint(point: [number, number], target: [number, number], heading: number, zoom: number): [number, number] {
  const a = heading * Math.PI / 180
  const dx = point[0] - target[0], dy = point[1] - target[1]
  return [200 + zoom * (dx * Math.cos(a) - dy * Math.sin(a)), 170 + zoom * (dx * Math.sin(a) + dy * Math.cos(a))]
}
