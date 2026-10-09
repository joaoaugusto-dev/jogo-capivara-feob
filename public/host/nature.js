import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Kenney Nature Kit + Car Kit (CC0). Cada GLB vira UMA geometria não indexada (position/normal/color),
// na escala original do kit (árvore padrão ≈ 1.7) e base em y=0 → o campus escala por categoria.
const FILES = {
  trees: ['tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_plateau', 'tree_small', 'tree_tall', 'tree_simple', 'tree_thin'], // os 6 primeiros = copas cheias (mais usados)
  pines: ['tree_pineRoundA', 'tree_pineTallA', 'tree_pineDefaultA', 'tree_cone'],
  ipe: ['tree_oak_fall', 'tree_default_fall', 'tree_detailed_fall'],
  palms: ['tree_palmTall', 'tree_palmDetailedTall'],
  bushes: ['plant_bush', 'plant_bushLarge', 'plant_bushSmall', 'plant_bushDetailed', 'plant_bushTriangle'],
  flowers: ['flower_redA', 'flower_redB', 'flower_yellowA', 'flower_yellowB', 'flower_purpleA', 'flower_purpleB'],
  reeds: ['plant_flatTall'],
  rocks: ['rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_largeA', 'rock_largeB'],
  stones: ['stone_smallA', 'stone_smallB', 'stone_largeA', 'stone_largeB'],
  forest: ['stump_round', 'stump_old', 'log', 'log_large', 'mushroom_redGroup', 'mushroom_tanGroup'],
  lily: ['lily_large', 'lily_small'],
};
const CARS = ['sedan', 'suv', 'hatchback-sports', 'van', 'sedan', 'suv', 'taxi', 'sedan-sports', 'suv-luxury', 'delivery', 'police'];

// paleta do campus ao entardecer (o kit vem verde-azulado): uma só família de cores para tudo combinar
const PAL = {
  leafsGreen: 0x5ea83e, leafsDark: 0x37803c, leafsFall: 0xf07ab4, woodBark: 0x6b5a4a, woodBarkDark: 0x52463c, woodBirch: 0x6b5a4a,
  woodInner: 0xd9b98a, grass: 0x55a23c, dirt: 0x7a6c5c, stone: 0x9d988e, colorRed: 0xe2474f, colorYellow: 0xf5c63a, colorPurple: 0xa463e0,
  colorTan: 0xdcc39c, _defaultMat: 0xf1ebe0,
};
const IPE_YELLOW = 0xf5c518;
const LEAF = /leafs|grass/;
const loader = new GLTFLoader();
const TOTAL = Object.values(FILES).flat().length + FILES.ipe.length + new Set(CARS).size;
let done = 0;
const tick = () => window.__progress?.((++done / TOTAL) * 0.7, 'CARREGANDO CAMPUS…');

// AO barato assado no vértice: base escura, copa mais escura por baixo
function bakeColor(g, color, leaf, h) {
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const y = Math.min(1, Math.max(0, p.getY(i) / h));
    let k = 0.6 + 0.4 * Math.min(1, y / 0.45);
    if (leaf) k *= 0.78 + 0.22 * Math.max(0, n.getY(i)) + 0.12 * y;
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const clean = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k); return g; };

async function bake(name, recolor = {}) {
  const { scene } = await loader.loadAsync(`/assets/nature/${name}.glb`);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), h = box.max.y - box.min.y, parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = clean(o.geometry.clone().applyMatrix4(o.matrixWorld)).translate(0, -box.min.y, 0), mn = o.material.name;
    bakeColor(g, recolor[mn] ?? PAL[mn] ?? 0x999999, LEAF.test(mn), h);
    parts.push(g);
  });
  const geo = mergeGeometries(parts); geo.computeBoundingSphere(); tick();
  return geo;
}

// carros: a textura-paleta vira cor de vértice (1 material para a cena toda); rodas de 332 tris → cilindro de 10 lados
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2);
async function bakeCar(name, pixels) {
  const { scene } = await loader.loadAsync(`/assets/cars/${name}.glb`);
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/wheel/.test(o.name)) {
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const w = clean(WHEEL.clone().scale(s.x, s.y / 2, s.z / 2).translate(c.x, c.y, c.z)), n = w.attributes.position.count;
      w.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.06), 3));
      return parts.push(w);
    }
    const src = o.geometry, uv = src.attributes.uv, g = clean(src.clone().applyMatrix4(o.matrixWorld));
    const idx = src.index, n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const j = idx ? idx.getX(i) : i, px = Math.min(511, Math.floor(uv.getX(j) * 512)), py = Math.min(511, Math.floor((1 - uv.getY(j)) * 512)) , k = (py * 512 + px) * 4;
      c.setRGB(pixels[k] / 255, pixels[k + 1] / 255, pixels[k + 2] / 255, THREE.SRGBColorSpace); col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  });
  const geo = mergeGeometries(parts); geo.computeBoundingBox();
  const b = geo.boundingBox, k = 4.4 / (b.max.z - b.min.z); // todos com ~4.4 m de comprimento
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(k, k, k); geo.computeBoundingSphere(); tick();
  return geo;
}
async function carPixels() {
  const img = await new THREE.ImageBitmapLoader().loadAsync('/assets/cars/Textures/colormap.png');
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 512, 512);
  return g.getImageData(0, 0, 512, 512).data;
}

export const nature = {};
await Promise.all(Object.entries(FILES).map(async ([k, names]) => { nature[k] = await Promise.all(names.map((n) => bake(n))); }));
nature.ipe.push(...(await Promise.all(FILES.ipe.map((n) => bake(n, { leafsFall: IPE_YELLOW }))))); // ipê rosa + ipê amarelo
{ const px = await carPixels(), cache = {}; nature.cars = await Promise.all(CARS.map((n) => (cache[n] ||= bakeCar(n, px)))); }
