import type { Map } from 'maplibre-gl'
import type { CameraMode } from './camera'
import type * as Cesium from 'cesium'

export interface CameraTarget { lng: number; lat: number; bearing: number; mode: CameraMode }
/** Engine boundary: callers supply calibrated WGS84; rendering owns no API polling. */
export interface MapEngine {
  follow(target: CameraTarget, reducedMotion: boolean): void
  release(): void
}

export function mapLibreEngine(map: Map): MapEngine {
  return {
    follow(target, reducedMotion) {
      map.easeTo({ center: [target.lng, target.lat], zoom: target.mode === 'chase' ? 17 : 15.8,
        bearing: target.mode === 'chase' ? target.bearing : 0,
        pitch: target.mode === 'chase' ? 68 : 40, duration: reducedMotion ? 0 : 450 })
    },
    release() { map.stop() },
  }
}

export function cesiumEngine(viewer: Cesium.CesiumWidget, C: typeof Cesium): MapEngine {
  return {
    follow(target) {
      const surface=viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(target.lng,target.lat))
      // Wait for real DEM coverage instead of inventing a terrain height.
      if(surface===undefined) return
      viewer.camera.lookAt(C.Cartesian3.fromDegrees(target.lng,target.lat,surface+3),new C.HeadingPitchRange(target.mode==='chase'?C.Math.toRadians(target.bearing):0,C.Math.toRadians(target.mode==='chase'?-28:-60),target.mode==='chase'?180:700))
    },
    release() { viewer.camera.lookAtTransform(C.Matrix4.IDENTITY) },
  }
}
