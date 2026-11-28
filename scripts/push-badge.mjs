// Genera public/push-badge.png: la silueta del logo de Pizarro (las tres barras de BrandMark.tsx, sin el cuadrado de
// fondo) en blanco sobre fondo transparente, 96×96. Es el `badge` de los avisos push (public/sw.js): Android solo pinta
// la silueta (el canal alfa) en la barra de estado, y con el icono a color salía un cuadrado blanco.
// Uso: node scripts/push-badge.mjs   (el PNG generado va al repositorio; solo hay que repetirlo si cambia el logo).
import { writeFileSync } from "node:fs";
import sharp from "sharp";

// Mismas barras que BrandMark (viewBox 32×32: x 6/13.25/20.5, ancho 5.5, desde y 7 con alto 18/12/7, esquinas 1.5);
// el viewBox recortado 3 3 26 26 las centra y las agranda. Las tres opacas: el alfa es lo único que Android usa.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 3 26 26" width="96" height="96">
  <rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="#fff"/>
  <rect x="13.25" y="7" width="5.5" height="12" rx="1.5" fill="#fff"/>
  <rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="#fff"/>
</svg>`;

const png = await sharp(Buffer.from(svg), { density: 384 }).resize(96, 96).png().toBuffer();
writeFileSync(new URL("../public/push-badge.png", import.meta.url), png);
console.log(`public/push-badge.png (${png.length} bytes)`);
