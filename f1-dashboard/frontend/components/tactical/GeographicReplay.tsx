'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { loadCesium } from '@/lib/tactical/cesium-runtime'
import { decodeTerrain } from '@/lib/tactical/terrain'
import { applyAlignment, checkAlignment, findCircuit, sampleTrack, type Alignment, type CircuitGeometry } from '@/lib/tactical/geography'
import { fixAt, latestAt, indexAt, trailColor, type ReplayData } from '@/lib/tactical/replay'
import { cesiumEngine } from '@/lib/tactical/mapEngine'
import type { CameraMode } from '@/lib/tactical/camera'

interface Props {
  data: ReplayData | null; location: string; time: number; selected: number | null; camera: CameraMode; maxGap: number
  onSelect: (id: number) => void; onFailure: (message: string) => void; onFree: () => void
}
export default function GeographicReplay(props: Props) {
  const container=useRef<HTMLDivElement>(null), viewer=useRef<Cesium.CesiumWidget | null>(null), runtime=useRef<typeof Cesium | null>(null)
  const latest=useRef(props); latest.current=props
  const [circuit,setCircuit]=useState<CircuitGeometry | null>(null), [fit,setFit]=useState<Alignment | null>(null)
  const [status,setStatus]=useState('Loading circuit reference…'),[ready,setReady]=useState(false),[terrainStatus,setTerrainStatus]=useState('Loading elevation tiles…')
  const previousFit=useRef<Alignment | null>(null), generation=useRef(0)
  const fitFor=useRef<ReplayData | null>(null)
  const markers=useRef(new Map<number,Cesium.Entity>()), trails=useRef(new Map<number,Cesium.Entity>())
  useEffect(() => {
    const controller=new AbortController()
    fetch('/tactical/circuits.geojson',{signal:controller.signal}).then(r => { if(!r.ok) throw new Error('Circuit reference unavailable.'); return r.json() }).then(geo => {
      const found=findCircuit(geo.features,props.location)
      if(!found) throw new Error('No geographic reference for this circuit. Local track view remains available.')
      setCircuit(found)
    }).catch(e => { if(!controller.signal.aborted) latest.current.onFailure(e.message) })
    return () => controller.abort()
  },[props.location])
  useEffect(() => {
    fitFor.current=null
    if(!circuit || !props.data || props.data.synthetic) { setFit(null); return }
    const points=sampleTrack(props.data.drivers.flatMap(d => d.fixes))
    if(previousFit.current) {
      const checked=checkAlignment(points,circuit,previousFit.current)
      if(checked.accepted) { fitFor.current=props.data;setFit(checked); setStatus('Estimated geographic alignment'); return }
    }
    setFit(null); setStatus('Checking track alignment…')
    const worker=new Worker(new URL('../../lib/tactical/geography.worker.ts',import.meta.url),{type:'module'})
    const timer=setTimeout(() => { worker.terminate(); setStatus('Alignment timed out. Cars withheld; use Local track or retry with a later replay window.') },15000)
    worker.onmessage=event => {
      clearTimeout(timer)
      const alignment=event.data.alignment as Alignment | null
      if(alignment?.accepted) { fitFor.current=props.data;previousFit.current=alignment; setFit(alignment); setStatus('Estimated geographic alignment') }
      else setStatus('Track alignment could not be verified. Cars withheld; use Local track or seek to a racing lap.')
      worker.terminate()
    }
    worker.onerror=() => { clearTimeout(timer); worker.terminate(); setStatus('Alignment unavailable. Use Local track.') }
    worker.postMessage({points,circuit})
    return () => { clearTimeout(timer); worker.terminate() }
  },[props.data,circuit])
  useEffect(() => {
    if(!circuit || !container.current) return
    const controller=new AbortController(); const run=++generation.current
    let instance: Cesium.CesiumWidget | undefined; let handler: Cesium.ScreenSpaceEventHandler | undefined
    void (async () => {
      try {
        const C=await loadCesium(); if(controller.signal.aborted || !container.current) return
        runtime.current=C
        let inflight=0,terrainFailed=false
        const terrain=new C.CustomHeightmapTerrainProvider({ width:65,height:65,tilingScheme:new C.WebMercatorTilingScheme(),
          credit:new C.Credit('Elevation: Terrain Tiles / USGS and contributors · <a href="/tactical/credits.txt" target="_blank" rel="noopener">Sources and attribution</a>',true),
          callback:(x,y,level) => {
            if(controller.signal.aborted || terrainFailed || inflight>=6 || level>14) return undefined
            inflight++
            return (async () => {
              const response=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${level}/${x}/${y}.png`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),cache:'force-cache'})
              if(!response.ok) throw new Error(`Elevation tile ${response.status}`)
              const bitmap=await createImageBitmap(await response.blob())
              try {
                if(bitmap.width!==256 || bitmap.height!==256) throw new Error('Invalid elevation tile')
                const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256
                const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx) throw new Error('Terrain decoding unavailable')
                ctx.drawImage(bitmap,0,0)
                const heights=decodeTerrain(ctx.getImageData(0,0,256,256).data)
                if(!controller.signal.aborted && !terrainFailed) setTerrainStatus('Elevation tiles active · source DEM heights')
                return heights
              } finally { bitmap.close() }
            })().catch(error => {
              if(!controller.signal.aborted && !terrainFailed) {
                terrainFailed=true;setTerrainStatus('Elevation unavailable · flat satellite globe')
                if(instance && !instance.isDestroyed()) { instance.terrainProvider=new C.EllipsoidTerrainProvider();instance.scene.requestRender() }
              }
              throw error
            }).finally(() => { inflight-- })
          },
        })
        // Mark the DEM leaf level; keep real geometric errors for imagery LOD.
        terrain.getTileDataAvailable=(_x,_y,level) => level<=14
        const requestGeometry=terrain.requestTileGeometry.bind(terrain)
        terrain.requestTileGeometry=(x,y,level,request) => requestGeometry(x,y,level,request)?.then(data => {
          if(level>=14) data.isChildAvailable=() => false
          return data
        })
        terrain.errorEvent.addEventListener(() => {})
        instance=new C.CesiumWidget(container.current,{baseLayer:false,terrainProvider:terrain,requestRenderMode:true,maximumRenderTimeChange:Infinity,skyBox:false,skyAtmosphere:false,showRenderLoopErrors:false})
        if(controller.signal.aborted) { instance.destroy(); return }
        viewer.current=instance
        instance.resolutionScale=Math.min(window.devicePixelRatio,1.5)
        instance.scene.globe.depthTestAgainstTerrain=true
        instance.scene.globe.maximumScreenSpaceError=3
        instance.scene.globe.tileCacheSize=64
        instance.scene.backgroundColor=C.Color.fromCssColorString('#071017')
        let imageErrors=0
        const imagery=new C.UrlTemplateImageryProvider({url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',maximumLevel:19,credit:new C.Credit('Imagery © Esri, Maxar, Earthstar Geographics',true)})
        imagery.errorEvent.addEventListener(() => { if(++imageErrors===5 && !controller.signal.aborted) latest.current.onFailure('Satellite imagery could not be loaded. Returned to local track view.') })
        instance.imageryLayers.addImageryProvider(imagery)
        const coords=circuit.geometry.coordinates
        const minLng=Math.min(...coords.map(p=>p[0])),maxLng=Math.max(...coords.map(p=>p[0])),minLat=Math.min(...coords.map(p=>p[1])),maxLat=Math.max(...coords.map(p=>p[1]))
        instance.camera.setView({destination:C.Rectangle.fromDegrees(minLng-.005,minLat-.005,maxLng+.005,maxLat+.005)})
        instance.entities.add({id:'reference-track',polyline:{positions:C.Cartesian3.fromDegreesArray(coords.flatMap(p=>[p[0],p[1]])),width:3,material:C.Color.fromCssColorString('#d5e6ad').withAlpha(.65),clampToGround:true}})
        handler=new C.ScreenSpaceEventHandler(instance.scene.canvas)
        handler.setInputAction((event:{position:Cesium.Cartesian2}) => {
          const picked=instance?.scene.pick(event.position);const id=picked?.id?.id
          if(typeof id==='string' && id.startsWith('driver-')) latest.current.onSelect(Number(id.slice(7)))
        },C.ScreenSpaceEventType.LEFT_CLICK)
        handler.setInputAction(() => latest.current.onFree(),C.ScreenSpaceEventType.LEFT_DOWN)
        instance.scene.renderError.addEventListener(() => { if(!controller.signal.aborted) latest.current.onFailure('The 3D renderer stopped. Returned to local track view.') })
        setReady(true)
      } catch(error) { if(!controller.signal.aborted) latest.current.onFailure(error instanceof Error ? error.message : '3D view unavailable. Returned to local track.') }
    })()
    return () => {
      controller.abort();handler?.destroy();if(instance && !instance.isDestroyed()) instance.destroy()
      if(generation.current===run) { viewer.current=null;setReady(false);markers.current.clear();trails.current.clear() }
    }
  },[circuit])
  useEffect(() => {
    const map=viewer.current,C=runtime.current
    if(!ready || !map || !C || map.isDestroyed()) return
    const visible=new Set<number>()
    if(fit && props.data && fitFor.current===props.data) for(const driver of props.data.drivers) {
      const fix=fixAt(driver.fixes,props.time,props.maxGap);if(!fix) continue
      const geo=applyAlignment(fix,fit), car=latestAt(driver.car,props.time)
      visible.add(driver.id)
      let entity=markers.current.get(driver.id)
      if(!entity) {
        entity=map.entities.add({id:`driver-${driver.id}`,label:{text:driver.acronym,font:'bold 13px monospace',showBackground:true,backgroundColor:C.Color.fromCssColorString('#071017'),pixelOffset:new C.Cartesian2(0,-23),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity},point:{pixelSize:9,heightReference:C.HeightReference.CLAMP_TO_GROUND,outlineWidth:2,outlineColor:C.Color.WHITE,disableDepthTestDistance:Infinity}})
        markers.current.set(driver.id,entity)
      }
      entity.position=new C.ConstantPositionProperty(C.Cartesian3.fromDegrees(geo.lng,geo.lat))
      if(entity.point) { entity.point.color=new C.ConstantProperty(C.Color.fromCssColorString(trailColor(car)));entity.point.pixelSize=new C.ConstantProperty(driver.id===props.selected?13:8) }
      const index=indexAt(driver.fixes,props.time)
      const samples=driver.fixes.slice(Math.max(0,index-40),index+1).filter(f=>props.time-f.t<=5000)
      const connected=samples.every((p,i)=>!i || p.t-samples[i-1].t<=props.maxGap)
      let trail=trails.current.get(driver.id)
      if(!trail) { trail=map.entities.add({id:`trail-${driver.id}`,polyline:{positions:[],width:3,clampToGround:true}});trails.current.set(driver.id,trail) }
      if(trail.polyline) { trail.polyline.positions=new C.ConstantProperty(connected && samples.length>1 ? samples.map(p=>{const g=applyAlignment(p,fit);return C.Cartesian3.fromDegrees(g.lng,g.lat)}) : []);trail.polyline.material=new C.ColorMaterialProperty(C.Color.fromCssColorString(trailColor(car)).withAlpha(.7)) }
      if(driver.id===props.selected && props.camera!=='free') {
        const before=fixAt(driver.fixes,props.time-500,props.maxGap),previous=before?applyAlignment(before,fit):null
        const bearing=previous ? Math.atan2((geo.lng-previous.lng)*Math.cos(geo.lat*Math.PI/180),geo.lat-previous.lat)*180/Math.PI : 0
        cesiumEngine(map,C).follow({...geo,bearing,mode:props.camera},true)
      }
    }
    for(const [id,entity] of markers.current) if(!visible.has(id)) {map.entities.remove(entity);markers.current.delete(id);const trail=trails.current.get(id);if(trail)map.entities.remove(trail);trails.current.delete(id)}
    container.current?.setAttribute('data-driver-count',String(visible.size))
    if(props.camera==='free' || !visible.has(props.selected ?? -1)) cesiumEngine(map,C).release()
    map.scene.requestRender()
  },[props.data,props.time,props.selected,props.camera,props.maxGap,fit,ready])
  return <div aria-label="Satellite terrain replay">
    <div ref={container} className="ops-map-surface" data-renderer-ready={ready} data-alignment={fit?.accepted?'accepted':'withheld'} data-camera-mode={props.camera} style={{height:'clamp(320px,50vw,600px)',width:'100%',position:'relative'}} />
    <div role="status" style={{padding:12,fontSize:12,lineHeight:1.6,color:'#bccbd7',background:'#0c151e'}}>
      {status}{fit && ` · ${fit.rms.toFixed(1)} m fit error · ${Math.round(fit.coverage*100)}% track coverage · not GPS`}<br/>{terrainStatus}
      <div style={{fontSize:11}}>Track matched to reference geometry; lateral positioning and elevation are not car measurements. <a href="/tactical/credits.txt" target="_blank" rel="noopener noreferrer" style={{color:'inherit'}}>Data sources and attribution</a></div>
    </div>
  </div>
}
