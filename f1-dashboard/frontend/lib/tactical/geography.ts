/** Circuit-shape registration, not GPS. All errors and thresholds are in metres. */
export type Point = { x: number; y: number }
export interface CircuitGeometry { properties: { id: string; Location: string; Name: string }; geometry: { type: string; coordinates: number[][] } }
export interface Alignment {
  a: number; b: number; tx: number; ty: number; mirror: number
  lng: number; lat: number; rms: number; p95: number; coverage: number; accepted: boolean
}
const RAD = Math.PI / 180, R = 6378137
const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
export function findCircuit(circuits: CircuitGeometry[], location: string) {
  const aliases: Record<string, string> = { spafrancorchamps: 'spa', montecarlo: 'monaco', miamigardens: 'miami', marinabay: 'singapore', yasmarina: 'yasmarina', abudhabi: 'yasmarina', bahrain: 'sakhir', catalunya: 'barcelona', austria: 'spielberg' }
  const key = clean(location), wanted = aliases[key] ?? key
  return circuits.find(c => { const name = clean(c.properties.Location); return name === wanted || (wanted === 'spa' && name === 'spafrancorchamps') })
}
export function applyAlignment(p: Point, fit: Alignment) {
  const y = p.y * fit.mirror
  const xM = fit.a * p.x - fit.b * y + fit.tx, yM = fit.b * p.x + fit.a * y + fit.ty
  return { lng: fit.lng + xM / (R * Math.cos(fit.lat * RAD)) / RAD, lat: fit.lat + yM / R / RAD }
}
function transform(p: Point, f: Alignment): Point { return { x: f.a * p.x - f.b * p.y * f.mirror + f.tx, y: f.b * p.x + f.a * p.y * f.mirror + f.ty } }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y) }
function nearest(p: Point, line: Point[]): Point {
  let best = line[0], d = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    const q = { x: a.x + t * dx, y: a.y + t * dy }, sq = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    if (sq < d) { d = sq; best = q }
  }
  return best
}
function mean(points: Point[]) { return { x: points.reduce((s,p) => s+p.x,0)/points.length, y: points.reduce((s,p) => s+p.y,0)/points.length } }
function radius(points: Point[], center: Point) { return Math.sqrt(points.reduce((s,p) => s + distance(p, center) ** 2, 0) / points.length) }
export function sampleTrack(points: Point[], limit = 240): Point[] {
  const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (p.x !== 0 || p.y !== 0))
  if (!valid.length) return []
  const center = mean(valid), size = radius(valid, center), cell = Math.max(1, size / 70)
  const unique = [...new Map(valid.map(p => [`${Math.round(p.x/cell)},${Math.round(p.y/cell)}`, p])).values()]
  const step = Math.max(1, unique.length / limit)
  return Array.from({ length: Math.min(limit, unique.length) }, (_,i) => unique[Math.floor(i*step)])
}
function reference(circuit: CircuitGeometry) {
  const coords = circuit.geometry.coordinates
  const lng = coords.reduce((s,p) => s+p[0],0)/coords.length, lat = coords.reduce((s,p) => s+p[1],0)/coords.length
  const points = coords.map(p => ({ x: (p[0]-lng)*RAD*R*Math.cos(lat*RAD), y: (p[1]-lat)*RAD*R }))
  return { lng, lat, points }
}
function quality(source: Point[], target: Point[], fit: Alignment) {
  const mapped = source.map(p => transform(p, fit)), errors = mapped.map(p => distance(p, nearest(p, target))).sort((a,b) => a-b)
  const rms = Math.sqrt(errors.slice(0, Math.ceil(errors.length*.9)).reduce((s,d) => s+d*d,0)/Math.ceil(errors.length*.9))
  const p95 = errors[Math.floor((errors.length-1)*.95)]
  const coverage = target.filter(p => mapped.some(q => distance(p,q) < 100)).length / target.length
  return { rms, p95, coverage, accepted: source.length >= 60 && rms <= 18 && p95 <= 40 && coverage >= .85 }
}
export function checkAlignment(points: Point[], circuit: CircuitGeometry, fit: Alignment) {
  return { ...fit, ...quality(sampleTrack(points), reference(circuit).points, fit) }
}
export function alignTrack(input: Point[], circuit: CircuitGeometry): Alignment | null {
  const source = sampleTrack(input), target = reference(circuit)
  if (source.length < 60 || target.points.length < 10) return null
  const pc = mean(source), qc = mean(target.points), scale = radius(target.points,qc)/radius(source,pc)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const candidates: Alignment[] = []
  for (const mirror of [1, -1]) for (let degrees = 0; degrees < 360; degrees += 15) {
    let a = scale*Math.cos(degrees*RAD), b = scale*Math.sin(degrees*RAD)
    let fit: Alignment = { a,b,tx:qc.x-a*pc.x+b*pc.y*mirror,ty:qc.y-b*pc.x-a*pc.y*mirror,mirror,lng:target.lng,lat:target.lat,rms:Infinity,p95:Infinity,coverage:0,accepted:false }
    for (let iter = 0; iter < 30; iter++) {
      const pairs = source.map(p => { const mapped=transform(p,fit), q=nearest(mapped,target.points); return { p:{ x:p.x,y:p.y*mirror },q,d:distance(mapped,q) } }).sort((u,v) => u.d-v.d).slice(0,Math.ceil(source.length*.9))
      const pm = mean(pairs.map(v=>v.p)), qm=mean(pairs.map(v=>v.q))
      let dot=0,cross=0,den=0
      for (const {p,q} of pairs) { const x=p.x-pm.x,y=p.y-pm.y,u=q.x-qm.x,v=q.y-qm.y; dot+=x*u+y*v; cross+=x*v-y*u; den+=x*x+y*y }
      if (den < 1) break
      a=dot/den; b=cross/den
      fit={...fit,a,b,tx:qm.x-a*pm.x+b*pm.y,ty:qm.y-b*pm.x-a*pm.y}
    }
    candidates.push({...fit,...quality(source,target.points,fit)})
  }
  candidates.sort((a,b) => (a.rms+a.p95*.2+(1-a.coverage)*100)-(b.rms+b.p95*.2+(1-b.coverage)*100))
  const best=candidates[0]
  // A second materially different transform with an equally good fit is ambiguous.
  const ambiguous=candidates.some(c => c!==best && c.accepted && c.rms < best.rms+3 && distance(transform(source[0],c),transform(source[0],best)) > 100)
  return {...best,accepted:best.accepted && !ambiguous}
}
