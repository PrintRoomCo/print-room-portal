import fs from 'node:fs'
import sharp from 'sharp'
const ref=fs.readFileSync('C:/Users/MSI/Downloads/neon_doodle_hat_vector.svg','utf8')
const cur=fs.readFileSync('public/merch/neon-cap.svg','utf8')

// crop both to the brim region and render side by side
function brim(svg, vb){ return svg.replace(/<svg[^>]*>/,`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="300" viewBox="${vb}">`) }
// reference is in 0..1254 space; current asset viewBox starts at 181 98 -> same underlying coords
const vb='150 640 950 470'
await sharp(Buffer.from(brim(ref,vb)),{density:300}).resize({width:520}).flatten({background:'#f2f2f2'}).png().toFile('tmp_ref_brim.png')
await sharp(Buffer.from(brim(cur,vb)),{density:300}).resize({width:520}).flatten({background:'#f2f2f2'}).png().toFile('tmp_cur_brim.png')
console.log('done')
