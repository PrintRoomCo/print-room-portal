import fs from 'node:fs'
import sharp from 'sharp'
const svg=fs.readFileSync('C:/Users/MSI/Downloads/neon_doodle_hat_vector.svg','utf8')
const nums=(s)=>(s.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number)
function bbox(list){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(let i=0;i+1<list.length;i+=2){const x=list[i],y=list[i+1];if(x<a)a=x;if(x>c)c=x;if(y<b)b=y;if(y>d)d=y}return{minX:a,minY:b,maxX:c,maxY:d}}
const dOf=(id)=>(svg.match(new RegExp(`id="${id}"[^>]*\\bd="([^"]*)"`))||[])[1]||''
const sil=nums(dOf('cap-silhouette'));const poly=[];for(let i=0;i+1<sil.length;i+=2)poly.push([sil[i],sil[i+1]])
function distSeg(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;const l2=dx*dx+dy*dy;let t=l2?((px-ax)*dx+(py-ay)*dy)/l2:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))}
function distEdge(px,py){let mn=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];mn=Math.min(mn,distSeg(px,py,a[0],a[1],b[0],b[1]))}return mn}
const m=svg.match(/(<path id="neon-green-embroidery-and-stitching" d=")([\s\S]*?)("[^>]*>)/)
const subs=m[2].split(/(?=M)/).map(s=>s.trim()).filter(Boolean)
let dropped=0
const coloured=subs.map(sp=>{const b=bbox(nums(sp));const cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2
  if(cy<560) return `<path d="${sp}" fill="#20406e"/>` // ignore upper crown for this view
  const kept=(cy>=790)||(distEdge(cx,cy)<80)
  if(!kept)dropped++
  return `<path d="${sp}" fill="${kept?'#39d353':'#ff2d2d'}"/>`}).join('')
const iso=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="181 620 893 500"><rect x="181" y="620" width="893" height="500" fill="#0a1c3a"/>${coloured}</svg>`
await sharp(Buffer.from(iso),{density:260}).resize({width:640}).png().toFile('tmp_brim.png')
console.log('lower-region dropped (red):',dropped)
