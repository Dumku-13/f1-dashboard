import type * as Cesium from 'cesium'
declare global { interface Window { Cesium?: typeof Cesium; CESIUM_BASE_URL?: string; CESIUM_WORKERS?: string } }
let pending: Promise<typeof Cesium> | undefined
export function loadCesium(): Promise<typeof Cesium> {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (pending) return pending
  window.CESIUM_BASE_URL='/cesium/'
  pending=new Promise((resolve,reject) => {
    if (!document.querySelector('link[data-cesium]')) { const css=document.createElement('link'); css.rel='stylesheet'; css.href='/cesium/Widgets/widgets.css'; css.dataset.cesium='true'; document.head.appendChild(css) }
    const script=document.createElement('script'); script.src='/cesium/Cesium.js'; script.async=true
    const timeout=setTimeout(() => { script.remove(); pending=undefined; reject(new Error('3D renderer load timed out.')) },20000)
    // Use the self-hosted ESM workers, not the UMD blob/importScripts bundle.
    script.onload=() => { clearTimeout(timeout); delete window.CESIUM_WORKERS; if(window.Cesium) resolve(window.Cesium); else { pending=undefined; reject(new Error('3D renderer unavailable.')) } }
    script.onerror=() => { clearTimeout(timeout); script.remove(); pending=undefined; reject(new Error('3D renderer unavailable.')) }
    document.head.appendChild(script)
  })
  return pending
}
