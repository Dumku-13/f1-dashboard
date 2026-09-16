/** Decode real Terrarium DEM data; never use OpenF1 z as altitude. */
export function terrariumHeight(r: number, g: number, b: number) { return r*256+g+b/256-32768 }
export function decodeTerrain(rgba: Uint8ClampedArray, tileSize = 256, size = 65) {
  if (rgba.length !== tileSize*tileSize*4) throw new Error('Invalid terrain tile dimensions')
  const buffer = new Float32Array(size*size)
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const px=x*(tileSize-1)/(size-1),py=y*(tileSize-1)/(size-1),x0=Math.floor(px),y0=Math.floor(py)
    const read=(u:number,v:number) => { const i=(Math.min(tileSize-1,v)*tileSize+Math.min(tileSize-1,u))*4; if (rgba[i+3]===0) throw new Error('Missing terrain elevation'); return terrariumHeight(rgba[i],rgba[i+1],rgba[i+2]) }
    const dx=px-x0,dy=py-y0
    buffer[y*size+x]=(read(x0,y0)*(1-dx)+read(x0+1,y0)*dx)*(1-dy)+(read(x0,y0+1)*(1-dx)+read(x0+1,y0+1)*dx)*dy
  }
  return buffer
}
