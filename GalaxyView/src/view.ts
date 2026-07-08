import * as THREE from 'three';
import { rOpts } from './settings';
import { UNIVERSE_BG_BASE64, PLANET_BASE_BASE64 } from './assets-data';
import type {
  DatabaseViewProps,
  GalaxyViewInstance,
  GalaxySceneInstance,
  RowData,
  GroupRowResult,
  PlanetData,
  MoonData,
  CameraAnimation
} from './types';
import { PALETTE } from './types';

// ═════════════════════════════════════════════════════════════
// 辅助与数据处理工具函数
// ═════════════════════════════════════════════════════════════

function fRows(groups: any[]): RowData[] {
  const l: RowData[] = [];
  (function w(list: any[]) {
    for (let i = 0; i < (list || []).length; i++) {
      const g = list[i];
      if (Array.isArray(g.groups) && g.groups.length > 0) {
        w(g.groups);
      } else {
        l.push(g);
      }
    }
  })(groups);
  
  return l.reduce<RowData[]>((a, g) => a.concat(g.rows || []), []);
}

function gTags(row: RowData, tf: string): string[] {
  if (!tf) return [];
  const v = row.$item ? row.$item[tf] : null;
  if (v == null || v === '') return [];
  if (Array.isArray(v)) {
    return v.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(v)
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function gHref(row: RowData, rl: { href: string } | null): string {
  if (rl && typeof rl.href === 'string' && rl.href) return rl.href;
  if (row && row.file && typeof row.file.path === 'string') return row.file.path;
  return '';
}

function grpRows(rows: RowData[], tf: string, fd: number): GroupRowResult[] {
  if (rows.length === 0) return [];
  
  // 无标签字段 → 按笔记所在文件夹层级分组
  if (!tf) {
    const depth = fd || 2;
    const fMap = new Map<string, RowData[]>();
    const fU: RowData[] = [];
    
    for (let fi = 0; fi < rows.length; fi++) {
      const fr = rows[fi];
      let fp = '';
      if (fr.file && fr.file.path) fp = fr.file.path;
      else if (fr.filePath) fp = fr.filePath;
      else fp = String(fr.id || '');
      
      const segs = fp.split('/').filter(Boolean);
      const fk = segs.length >= depth + 1 ? segs[depth - 1] : '';
      if (fk) {
        if (!fMap.has(fk)) fMap.set(fk, []);
        fMap.get(fk)!.push(fr);
      } else {
        fU.push(fr);
      }
    }
    
    const fSorted = Array.from(fMap.entries()).sort((a, b) => b[1].length - a[1].length);
    const fRes: GroupRowResult[] = fSorted.map(([key, value], idx) => ({
      key,
      label: key,
      rows: value,
      ci: idx
    }));
    
    if (fU.length) {
      fRes.unshift({ key: '__u__', label: '其他', rows: fU, ci: 0 });
    }
    return fRes;
  }
  
  // 有标签字段 → 按标签组合分组
  const map = new Map<string, RowData[]>();
  const u: RowData[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = gTags(r, tf);
    if (t.length > 0) {
      const k = t.slice().sort().join(' | ');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    } else {
      u.push(r);
    }
  }
  
  const sorted = Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  const res: GroupRowResult[] = sorted.map(([key, value], idx) => ({
    key,
    label: key,
    rows: value,
    ci: idx
  }));
  
  if (u.length) {
    res.unshift({ key: '__u__', label: '其他', rows: u, ci: 0 });
  }
  return res;
}

// ═════════════════════════════════════════════════════════════
// 纹理生成与色相变换工具
// ═════════════════════════════════════════════════════════════

function mulberry32(s: number): () => number {
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    const a = Math.imul(s ^ (s >>> 15), 1 | s);
    const b = Math.imul(s ^ (s >>> 7), 61 | s);
    const t = (a + b) ^ s;
    return (t >>> 0) / 4294967296;
  };
}

function pTex(hex: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d')!;
  const col = new THREE.Color(hex);
  
  function sh(k: number) {
    return '#' + col.clone().multiplyScalar(k).getHexString();
  }
  
  const rnd = mulberry32(seed);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, sh(0.75));
  g.addColorStop(0.5, sh(1.35));
  g.addColorStop(1, sh(0.6));
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  
  for (let i = 0; i < 14; i++) {
    x.fillStyle = sh(0.5 + rnd() * 1.1) + Math.floor(34 + rnd() * 60).toString(16);
    const y = rnd() * 256;
    x.fillRect(0, y, 512, 4 + rnd() * 18);
  }
  
  for (let i = 0; i < 90; i++) {
    x.fillStyle = sh(0.45 + rnd() * 1.2) + Math.floor(24 + rnd() * 56).toString(16);
    x.beginPath();
    x.ellipse(
      rnd() * 512,
      rnd() * 256,
      6 + rnd() * 36,
      3 + rnd() * 12,
      rnd() * Math.PI,
      0,
      Math.PI * 2
    );
    x.fill();
  }
  
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function gTex(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color + 'cc');
  g.addColorStop(0.35, color + '55');
  g.addColorStop(1, color + '00');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  
  const d = max - min;
  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  return h;
}

function hueShiftCanvas(
  img: HTMLImageElement | HTMLCanvasElement,
  hueDeg: number
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const mw = 1024;
  const s = Math.min(1, mw / Math.max(img.width || 512, img.height || 256));
  c.width = (img.width || 512) * s;
  c.height = (img.height || 256) * s;
  
  const x = c.getContext('2d')!;
  x.filter = `hue-rotate(${hueDeg}deg)`;
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ═════════════════════════════════════════════════════════════
// 着色器代码常量
// ═════════════════════════════════════════════════════════════

const ATM_VERT = `
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const ATM_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vPos;

float hash(vec3 p) {
  p = fract(p * .3183099 + .1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0,0.0,0.0)), f.x), mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x), mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y),
    f.z
  );
}

void main() {
  vec3 n = normalize(vNormal);
  float rim = pow(1.0 - abs(dot(n, normalize(-vPos))), 2.2);
  float n1 = noise(n * 6.0 + vec3(0.0, uTime * 0.7, uSeed));
  float n2 = noise(n * 14.0 - vec3(uTime * 0.9, 0.0, uSeed * 2.0));
  float ridge = 1.0 - abs(2.0 * mix(n1, n2, 0.5) - 1.0);
  float arc = smoothstep(0.90, 1.0, ridge) * (0.55 + 0.45 * sin(uTime * 7.0 + uSeed * 10.0));
  float a = rim * 0.8 + pow(rim, 1.6) * arc * 2.4;
  gl_FragColor = vec4(uColor + vec3(0.85) * arc * rim, a * uOpacity);
}
`;

// ═════════════════════════════════════════════════════════════
// 3D 渲染核心逻辑
// ═════════════════════════════════════════════════════════════

function createGalaxyScene(
  props: DatabaseViewProps,
  container: HTMLDivElement
): GalaxySceneInstance {
  let W = container.clientWidth || window.innerWidth;
  let H = container.clientHeight || window.innerHeight;
  
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04060f, 0.0006);
  
  const camera = new THREE.PerspectiveCamera(55, W / Math.max(H, 1), 0.1, 2000);
  const HOME = new THREE.Vector3(0, 82, 164);
  camera.position.copy(HOME);
  
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(0x04060f, 1);
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  
  scene.add(new THREE.AmbientLight(0x3a4a78, 1.3));
  scene.add(new THREE.HemisphereLight(0x8899ff, 0x140a24, 0.7));
  
  const coreLight = new THREE.PointLight(0xffe8c8, 2.4, 0, 0);
  scene.add(coreLight);
  
  const sunLight = new THREE.DirectionalLight(0xbfd4ff, 1.6);
  sunLight.position.set(200, 300, 200);
  scene.add(sunLight);
  scene.add(sunLight.target);
  
  const galaxy = new THREE.Group();
  scene.add(galaxy);
  scene.add(camera);
  
  // 选项参数
  const opts = rOpts(props.viewDefinition);

  // 解析背景图贴图地址
  let universeUrl = UNIVERSE_BG_BASE64;
  if (opts.universeBgPath && props.app) {
    const file = props.app.vault.getAbstractFileByPath(opts.universeBgPath);
    if (file && 'path' in file) {
      universeUrl = props.app.vault.getResourcePath(file as any);
    }
  }

  // 解析星球基本贴图地址
  let planetBaseUrl = PLANET_BASE_BASE64;
  if (opts.planetBasePath && props.app) {
    const file = props.app.vault.getAbstractFileByPath(opts.planetBasePath);
    if (file && 'path' in file) {
      planetBaseUrl = props.app.vault.getResourcePath(file as any);
    }
  }
  
  // Background 背景天空盒
  let bgPlane: THREE.Mesh | null = null;
  new THREE.TextureLoader().load(universeUrl, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    bgPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 1460),
      new THREE.MeshBasicMaterial({ map: t, fog: false })
    );
    bgPlane.position.z = -900;
    camera.add(bgPlane);
  });
  
  // Starfield 背景尘埃星海
  function stars(n: number, sz: number, rMin: number, rMax: number, op: number) {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(rMin + Math.random() * (rMax - rMin));
      p.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    scene.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0xcfe2ff,
          size: sz,
          sizeAttenuation: true,
          transparent: true,
          opacity: op,
          depthWrite: false
        })
      )
    );
  }
  
  stars(2400, 1.1, 260, 640, 0.9);
  stars(1500, 0.6, 200, 640, 0.6);
  stars(500, 2.0, 300, 640, 0.5);
  
  const nebulas: Array<[string, number, number, number, number]> = [
    ['#7c3aed', -260, 40, -340, 420],
    ['#1d4ed8', 300, -60, -380, 520],
    ['#0e7490', -340, -90, -300, 380],
    ['#9d174d', 240, 120, -420, 460]
  ];
  nebulas.forEach((a) => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: gTex(a[0]),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    sp.position.set(a[1], a[2], a[3]);
    sp.scale.setScalar(a[4]);
    scene.add(sp);
  });
  
  // Spiral core 星系旋臂中心尘埃
  const N = 9000;
  const R = 27;
  const branches = 4;
  const cp = new Float32Array(N * 3);
  const cc = new Float32Array(N * 3);
  const cIn = new THREE.Color('#ffc879');
  const cMid = new THREE.Color('#c084fc');
  const cOut = new THREE.Color('#5a6cf0');
  
  for (let i = 0; i < N; i++) {
    const r = Math.pow(Math.random(), 1.45) * R;
    const a = ((i % branches) / branches) * Math.PI * 2 + r * 1.25;
    const rd = function () {
      return (Math.random() - 0.5) * Math.pow(Math.random(), 2) * 10 * (1 - (r / R) * 0.45);
    };
    cp.set([Math.cos(a) * r + rd(), rd() * 0.5, Math.sin(a) * r + rd()], i * 3);
    const t = r / R;
    const col =
      t < 0.5 ? cIn.clone().lerp(cMid, t * 2) : cMid.clone().lerp(cOut, t * 2 - 1);
    cc.set([col.r, col.g, col.b], i * 3);
  }
  
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  
  const corePts = new THREE.Points(
    cg,
    new THREE.PointsMaterial({
      size: 0.45,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  corePts.name = 'core';
  galaxy.add(corePts);
  
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: gTex('#ffe2b0'),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  halo.scale.setScalar(26);
  galaxy.add(halo);
  
  // Planets 星球初始化
  const rows = fRows(props.viewData ? props.viewData.groups : []);
  const groups = grpRows(rows, opts.tagField, opts.folderDepth);
  const maxN = Math.max(1, groups.reduce((a, g) => Math.max(a, g.rows.length), 0));
  
  const planets: PlanetData[] = [];
  
  // 标签层 DOM 容器
  const labelsDiv = document.createElement('div');
  labelsDiv.className = 'components--GxLabels';
  container.appendChild(labelsDiv);
  
  // 聚焦面板状态 DOM
  const focusLabel = document.createElement('div');
  focusLabel.className = 'components--GxFocusLabel';
  labelsDiv.appendChild(focusLabel);
  
  const backBtn = document.createElement('div');
  backBtn.className = 'components--GxBackBtn';
  backBtn.innerHTML = '返回';
  backBtn.style.display = 'none';
  container.appendChild(backBtn);
  
  // 星球/卫星焦点状态
  let focus: PlanetData | null = null;
  let moons: MoonData[] = [];
  let camAnim: CameraAnimation | null = null;
  
  backBtn.onclick = () => {
    leaveFocus();
  };
  
  // 创建星球的辅助方法
  function addPlanetMesh(g: GroupRowResult, idx: number, orbR: number) {
    const color = PALETTE[g.ci % PALETTE.length];
    const radius = 4.0 + 4.4 * Math.sqrt(g.rows.length / maxN);
    const angle0 = idx * 2.399963 + 0.8;
    
    const pivot = new THREE.Group();
    pivot.rotation.y = angle0;
    galaxy.add(pivot);
    
    const grp = new THREE.Group();
    grp.position.x = orbR;
    pivot.add(grp);
    
    const mat = new THREE.MeshStandardMaterial({
      map: pTex(color, 1000 + idx * 77),
      roughness: 0.7,
      metalness: 0.12,
      emissive: new THREE.Color(color).multiplyScalar(0.8)
    });
    
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
    mesh.rotation.z = 0.15;
    grp.add(mesh);
    
    const atm = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0.7 },
        uTime: { value: 0 },
        uSeed: { value: idx * 7.3 }
      },
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    
    const atmMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.22, 48, 48), atm);
    grp.add(atmMesh);
    
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: gTex(color),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.scale.setScalar(radius * 3.1);
    grp.add(glow);
    
    // Saturn rings 星球卫星环
    if (g.rows.length >= opts.ringThreshold) {
      const rrSpecs: Array<[number, number, number]> = [
        [1.5, 2.15, 0.25],
        [2.25, 2.38, 0.4]
      ];
      rrSpecs.forEach((rr) => {
        const rm = new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: rr[2],
          depthWrite: false
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * rr[0], radius * rr[1], 80), rm);
        ring.rotation.x = Math.PI / 2 - 0.32;
        grp.add(ring);
      });
    }
    
    // 从基本图片载入漫反射与高光色相偏移
    new THREE.TextureLoader().load(planetBaseUrl, (t) => {
      const canvas = hueShiftCanvas(t.image, hexToHue(color));
      const ct = new THREE.CanvasTexture(canvas);
      ct.colorSpace = THREE.SRGBColorSpace;
      mat.map = ct;
      mat.emissiveMap = ct;
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 3.0;
      mat.roughness = 0.55;
      mat.needsUpdate = true;
      if (pDat.label) pDat.label.style.setProperty('--c', color);
    });
    
    // Orbit line 星球公转轨道线
    const oPts: THREE.Vector3[] = [];
    for (let k = 0; k <= 128; k++) {
      const ak = (k / 128) * Math.PI * 2;
      oPts.push(new THREE.Vector3(Math.cos(ak) * orbR, 0, Math.sin(ak) * orbR));
    }
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x5a8cf0,
      transparent: true,
      opacity: 0.38
    });
    galaxy.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(oPts), orbitMat));
    
    // 创建 DOM 标签
    const lbl = document.createElement('div');
    lbl.className = 'components--GxLabel';
    lbl.style.setProperty('--c', color);
    lbl.innerHTML = `<div class="en">${g.label}</div><div class="zh">${g.rows.length} 条笔记</div>`;
    labelsDiv.appendChild(lbl);
    
    const pDat: PlanetData = {
      data: g,
      color,
      pivot,
      grp,
      mesh,
      atmMesh,
      glow: glow.material,
      atm,
      orbitMat,
      radius,
      orbR,
      speed: 0.02,
      spin: 0.25 + (idx % 3) * 0.08,
      hover: false,
      scl: 1,
      label: lbl
    };
    
    return pDat;
  }
  
  // 建立原始的星球
  groups.forEach((g, i) => {
    const rJit = ((g.key.length * 7 + g.key.charCodeAt(0)) % 7 - 3) * 1.2;
    const orbR = Math.max(48, 36 + i * 12.5 + rJit);
    planets.push(addPlanetMesh(g, i, orbR));
  });
  
  function enterFocus(p: PlanetData) {
    if (focus === p) return;
    leaveFocus();
    focus = p;
    backBtn.style.display = 'block';
    labelsDiv.classList.remove('components--GxMoonsVisible');
    
    const oldSys = p.grp.getObjectByName('moonSys');
    if (oldSys) {
      oldSys.removeFromParent();
    }
    
    camD = 1;
    tCD = 1;
    
    const moonCount = Math.min(p.data.rows.length, 30);
    const moonSys = new THREE.Group();
    moonSys.name = 'moonSys';
    p.grp.add(moonSys);
    
    const layers = Math.min(8, moonCount <= 3 ? 1 : moonCount <= 8 ? 3 : moonCount <= 15 ? 5 : 8);
    const baseD = p.radius * 1.9;
    const lGap = 2.6;
    const moonR = 0.42 + 0.35 * Math.sqrt(Math.max(1, p.data.rows.length) / maxN);
    
    p.data.rows.slice(0, moonCount).forEach((row, idx) => {
      const layer = idx % layers;
      const posInLayer = Math.floor(idx / layers);
      const totalInLayer = Math.ceil((moonCount - layer) / layers);
      const md = baseD + layer * lGap;
      const angle = posInLayer * ((Math.PI * 2) / Math.max(1, totalInLayer)) + layer * 0.618;
      const mr = moonR * (0.82 + layer * 0.06);
      
      const piv = new THREE.Group();
      piv.rotation.y = angle;
      moonSys.add(piv);
      
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(mr, 22, 22),
        new THREE.MeshStandardMaterial({
          map: pTex(p.color, 7000 + idx * 31),
          roughness: 0.22,
          metalness: 0.6,
          emissive: new THREE.Color(p.color).multiplyScalar(0.5)
        })
      );
      m.position.x = md;
      piv.add(m);
      m.visible = false;
      
      const mlbl = document.createElement('div');
      mlbl.className = 'components--GxMoonLabel';
      
      const tf = opts.titleField;
      let t = '';
      if (tf && row.$item) {
        const rv = row.$item[tf];
        t = rv != null ? String(rv).trim() : '';
      }
      if (!t && row.$item) {
        t = String(row.$item.title || row.$item.name || '').trim();
      }
      if (!t) {
        const fid = String(row.id || '');
        t = fid.split('/').pop()?.replace(/\.[^.]+$/, '') || '·';
      }
      
      mlbl.textContent = t.length > 24 ? t.slice(0, 22) + '…' : t;
      labelsDiv.appendChild(mlbl);
      
      moons.push({
        pivot: piv,
        mesh: m,
        label: mlbl,
        speed: 0.06,
        row: row,
        scl: 1
      });
    });
    
    focusLabel.innerHTML = `<div class="en">${p.data.label}</div><div class="zh">${p.data.rows.length} 条笔记</div>`;
    focusLabel.style.setProperty('--c', p.color);
    focusLabel.style.opacity = '0';
    
    const c = p.grp.getWorldPosition(new THREE.Vector3());
    camAnim = {
      t: 0,
      from: camera.position.clone(),
      to: c.clone(),
      lookFrom: new THREE.Vector3(0, 0, 0),
      planet: p,
      mode: 'in'
    };
    
    planets.forEach((o) => {
      if (o !== p) {
        o.mesh.material.transparent = true;
        o.mesh.material.needsUpdate = true;
      }
    });
    labelsDiv.classList.add('components--GxLabels--hidden');
  }
  
  function leaveFocus() {
    if (!focus) return;
    backBtn.style.display = 'none';
    focusLabel.style.opacity = '0';
    labelsDiv.classList.remove('components--GxMoonsVisible');
    
    moons.forEach((m) => {
      m.label.style.opacity = '0';
      m.pivot.removeFromParent();
      m.mesh.geometry.dispose();
      (m.mesh.material as THREE.Material).dispose();
      m.label.remove();
    });
    moons = [];
    
    const ms = focus.grp.getObjectByName('moonSys');
    if (ms) ms.removeFromParent();
    
    camD = 1;
    tCD = 1;
    
    const look = focus.grp.getWorldPosition(new THREE.Vector3());
    camAnim = {
      t: 0,
      from: camera.position.clone(),
      to: HOME.clone(),
      lookFrom: look.clone(),
      mode: 'out'
    };
    
    planets.forEach((o) => {
      o.mesh.material.transparent = false;
      o.mesh.material.opacity = 1;
      o.mesh.material.needsUpdate = true;
      o.glow.opacity = 0.55;
      o.atm.uniforms.uOpacity.value = 0.7;
      o.orbitMat.opacity = 0.16;
    });
    
    labelsDiv.classList.remove('components--GxLabels--hidden');
    focus = null;
  }
  
  // 3D 鼠标/指针射线与交互
  const ray = new THREE.Raycaster();
  ray.far = 2000;
  const ptr = new THREE.Vector2();
  
  function sPtr(e: PointerEvent) {
    const r = container.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  
  function pickTarget() {
    ray.setFromCamera(ptr, camera);
    if (focus) {
      const mm = moons.map((m) => m.mesh);
      const mh = ray.intersectObjects(mm, false)[0];
      return mh
        ? {
            type: 'moon' as const,
            obj: moons.find((m) => m.mesh === mh.object)!
          }
        : null;
    }
    
    const at: THREE.Object3D[] = [];
    planets.forEach((p) => {
      at.push(p.mesh, p.atmMesh);
    });
    const ph = ray.intersectObjects(at, false)[0];
    return ph
      ? {
          type: 'planet' as const,
          obj: planets.find((p) => p.mesh === ph.object || p.atmMesh === ph.object)!
        }
      : null;
  }
  
  let rotY = 0.4;
  let rotX = 0.12;
  let tRY = rotY;
  let tRX = rotX;
  let camD = 1;
  let tCD = 1;
  
  let drag: { x: number; y: number; m: number; target: ReturnType<typeof pickTarget> } | null = null;
  let hover: PlanetData | null = null;
  let moonHover: MoonData | null = null;
  
  container.addEventListener('pointerdown', (e) => {
    sPtr(e);
    const t = pickTarget();
    drag = { x: e.clientX, y: e.clientY, m: 0, target: t };
  });
  
  container.addEventListener('pointermove', (e) => {
    sPtr(e);
    if (drag) {
      drag.m += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      if (focus) {
        const ms = focus.grp.getObjectByName('moonSys');
        if (ms) ms.rotation.y += (e.clientX - drag.x) * 0.008;
      } else {
        tRY += (e.clientX - drag.x) * 0.0045;
        tRX = THREE.MathUtils.clamp(
          tRX + (e.clientY - drag.y) * 0.003,
          -0.25,
          Math.atan(164 / 82)
        );
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
    
    if (!drag) {
      const t = pickTarget();
      hover = t && t.type === 'planet' ? t.obj : null;
      moonHover = t && t.type === 'moon' ? t.obj : null;
      container.style.cursor = t ? 'pointer' : focus ? 'grab' : 'grab';
    }
  });
  
  container.addEventListener('pointerup', (e) => {
    const clicked = drag && drag.m < 6 && drag.target;
    if (clicked) {
      if (clicked.type === 'planet') {
        enterFocus(clicked.obj);
      } else if (clicked.type === 'moon' && clicked.obj.row) {
        const rl = props.api && props.api.getRowLink ? props.api.getRowLink(clicked.obj.row.id) : null;
        const h = gHref(clicked.obj.row, rl);
        if (h) {
          const a = document.createElement('a');
          a.className = 'internal-link components--DatabaseLinkFieldLink';
          a.setAttribute('data-href', h);
          a.setAttribute('href', ' ');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          a.style.display = 'none';
          container.appendChild(a);
          a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          setTimeout(() => {
            a.remove();
          }, 50);
        }
      }
    }
    drag = null;
  });
  
  container.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      tCD = THREE.MathUtils.clamp(tCD * (1 + Math.sign(e.deltaY) * 0.08), 0.4, 3.5);
    },
    { passive: false }
  );
  
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') leaveFocus();
  };
  window.addEventListener('keydown', escHandler);
  
  // 动画循环
  const clock = new THREE.Clock();
  let animId = 0;
  const lPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  
  function place(el: HTMLDivElement, obj: THREE.Object3D, yOff: number) {
    obj.getWorldPosition(lPos);
    lPos.y += yOff;
    lPos.project(camera);
    const behind = lPos.z > 1;
    el.style.opacity = behind ? '0' : '1';
    if (!behind) {
      el.style.left = (lPos.x * 0.5 + 0.5) * W + 'px';
      el.style.top = (-lPos.y * 0.5 + 0.5) * H + 'px';
    }
  }
  
  function placeMoon(el: HTMLDivElement, obj: THREE.Object3D, yOff: number) {
    obj.getWorldPosition(lPos);
    lPos.y += yOff;
    lPos.project(camera);
    if (lPos.z <= 1) {
      el.style.left = (lPos.x * 0.5 + 0.5) * W + 'px';
      el.style.top = (-lPos.y * 0.5 + 0.5) * H + 'px';
    }
  }
  
  const ease = function (t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  
  function loop() {
    animId = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    
    const core = galaxy.getObjectByName('core');
    if (core) core.rotation.y = t * 0.02;
    
    rotY += (tRY - rotY) * 0.06;
    rotX += (tRX - rotX) * 0.06;
    galaxy.rotation.y = rotY;
    galaxy.rotation.x = rotX;
    
    camD += (tCD - camD) * 0.08;
    
    planets.forEach((p) => {
      if (!focus) p.pivot.rotation.y += p.speed * dt;
      p.mesh.rotation.y += p.spin * dt * (p === hover ? 5 : 1);
      
      const tg = p === hover && !focus ? 1.13 : 1;
      p.scl += (tg - p.scl) * 0.1;
      p.grp.scale.setScalar(p.scl);
      
      const glowTgt = p === focus ? 0.18 : p === hover ? 0.85 : 0.55;
      p.glow.opacity += (glowTgt - p.glow.opacity) * 0.1;
      p.atm.uniforms.uTime.value = t;
      
      const dim = focus && p !== focus;
      p.mesh.material.opacity += ((dim ? 0.015 : 1) - p.mesh.material.opacity) * 0.07;
      p.orbitMat.opacity += ((dim ? 0.008 : 0.16) - p.orbitMat.opacity) * 0.07;
      if (dim) p.glow.opacity = Math.min(p.glow.opacity, 0.02);
    });
    
    if (bgPlane) {
      const k = bgPlane.material.color.r + ((focus ? 0.15 : 1) - bgPlane.material.color.r) * 0.06;
      bgPlane.material.color.setScalar(k);
    }
    
    moons.forEach((m) => {
      m.pivot.rotation.y += m.speed * dt;
      m.mesh.rotation.y += dt;
      const mt = m === moonHover ? 1.18 : 1;
      m.scl += (mt - m.scl) * 0.12;
      m.mesh.scale.setScalar(m.scl);
      m.mesh.material.emissiveIntensity =
        (m === moonHover ? 0.65 : 0.4) + (m.mesh.material.emissiveIntensity - (m === moonHover ? 0.65 : 0.4)) * 0.1;
    });
    
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + dt / 1.5);
      const k = ease(camAnim.t);
      if (camAnim.mode === 'in' && camAnim.planet) {
        const ct = camAnim.planet.grp.getWorldPosition(tmp);
        const dr = ct.clone().sub(galaxy.position).setY(0).normalize();
        camAnim.to
          .copy(ct)
          .add(dr.multiplyScalar(camAnim.planet.radius * 5.2))
          .add(new THREE.Vector3(0, camAnim.planet.radius * 1.9, 0));
        tmp.lerpVectors(camAnim.lookFrom, ct, k);
      } else {
        tmp.lerpVectors(camAnim.lookFrom, new THREE.Vector3(0, 0, 0), k);
      }
      camera.position.lerpVectors(camAnim.from, camAnim.to, k);
      camera.lookAt(tmp);
      
      if (camAnim.t >= 1) {
        if (camAnim.mode === 'in') {
          focusLabel.style.opacity = '1';
          labelsDiv.classList.add('components--GxMoonsVisible');
          moons.forEach((m) => {
            m.mesh.visible = true;
          });
        }
        camAnim = null;
      }
    } else if (focus) {
      const c = focus.grp.getWorldPosition(tmp);
      const dir = c.clone().sub(galaxy.position).setY(0).normalize();
      camera.position
        .copy(c)
        .add(dir.multiplyScalar(focus.radius * 5.2 * camD))
        .add(new THREE.Vector3(0, focus.radius * 1.9 * camD, 0));
      camera.lookAt(c);
    } else {
      camera.position.copy(HOME).multiplyScalar(camD);
      camera.lookAt(0, 0, 0);
    }
    
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    
    if (bgPlane) {
      bgPlane.position.x = Math.sin(rotY) * -38;
      bgPlane.position.y = Math.sin(rotX) * -26;
    }
    
    planets.forEach((p) => {
      place(p.label, p.grp, p.radius * 1.75);
    });
    moons.forEach((m) => {
      placeMoon(m.label, m.mesh, 0.9);
    });
    
    renderer.render(scene, camera);
  }
  
  loop();
  
  // 联动更新：在多维表联动中更新数据
  function updateData(newProps: DatabaseViewProps) {
    const newRows = fRows(newProps.viewData ? newProps.viewData.groups : []);
    const newOpts = rOpts(newProps.viewDefinition);
    const newGroups = grpRows(newRows, newOpts.tagField, newOpts.folderDepth);
    const newMaxN = Math.max(1, newGroups.reduce((a, g) => Math.max(a, g.rows.length), 0));
    
    const newKeys: Record<string, GroupRowResult> = {};
    newGroups.forEach((g) => {
      newKeys[g.key] = g;
    });
    
    // 更新已有星球数据 & 隐藏被删除的星球
    planets.forEach((p) => {
      const g = newKeys[p.data.key];
      if (g) {
        p.data.rows = g.rows;
        p.data.label = g.label;
        p.data.ci = g.ci;
        p.label.innerHTML = `<div class="en">${g.label}</div><div class="zh">${g.rows.length} 条笔记</div>`;
        p.label.style.display = '';
        p.pivot.visible = true;
      } else {
        p.label.style.display = 'none';
        p.pivot.visible = false;
      }
    });
    
    // 新增星球
    let addI = planets.length;
    newGroups.forEach((g) => {
      if (planets.some((p) => p.data.key === g.key)) return;
      const rJit = ((g.key.length * 7 + g.key.charCodeAt(0)) % 7 - 3) * 1.2;
      const orbR = Math.max(48, 36 + addI * 12.5 + rJit);
      planets.push(addPlanetMesh(g, addI, orbR));
      addI++;
    });
  }
  
  return {
    destroy() {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', escHandler);
      renderer.dispose();
      
      planets.forEach((p) => {
        p.label.remove();
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        p.atm.dispose();
        p.glow.dispose();
      });
      
      moons.forEach((m) => {
        m.label.remove();
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
      });
      
      labelsDiv.remove();
      backBtn.remove();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
    updateData
  };
}

// ═════════════════════════════════════════════════════════════
// 视图外部接口定义
// ═════════════════════════════════════════════════════════════

export function createGalaxyView(): GalaxyViewInstance {
  const S: {
    scene: GalaxySceneInstance | null;
    root: HTMLDivElement | null;
    canvasEl: HTMLDivElement | null;
    loading: boolean;
    lastUniverseBgPath: string;
    lastPlanetBasePath: string;
  } = {
    scene: null,
    root: null,
    canvasEl: null,
    loading: false,
    lastUniverseBgPath: '',
    lastPlanetBasePath: ''
  };
  
  function showErr(msg: string) {
    console.error('[Galaxy]', msg);
    if (S.root) S.root.textContent = msg;
    if (S.canvasEl) S.canvasEl.textContent = msg;
  }
  
  return {
    onUpdate(props: DatabaseViewProps) {
      if (!S.root) {
        S.root = document.createElement('div');
        S.root.className = 'components--GxRoot';
        
        S.canvasEl = document.createElement('div');
        S.canvasEl.className = 'components--GxCanvas';
        
        S.root.appendChild(S.canvasEl);
        props.container.classList.add('components--GxHost');
        props.container.replaceChildren(S.root);
      }
      
      // 场景已建立 -> 检查配置路径变更以驱动热重载
      const curOpts = rOpts(props.viewDefinition);
      if (S.scene && !S.loading) {
        if (
          curOpts.universeBgPath !== S.lastUniverseBgPath ||
          curOpts.planetBasePath !== S.lastPlanetBasePath
        ) {
          S.scene.destroy();
          S.scene = null;
        } else {
          S.scene.updateData(props);
          return;
        }
      }
      
      if (S.scene || S.loading) return;
      if (!S.canvasEl || !S.canvasEl.isConnected) return;
      
      S.loading = true;
      S.lastUniverseBgPath = curOpts.universeBgPath;
      S.lastPlanetBasePath = curOpts.planetBasePath;
      
      try {
        if (THREE.Cache) THREE.Cache.clear();
        S.scene = createGalaxyScene(props, S.canvasEl);
        S.loading = false;
      } catch (e: any) {
        showErr('场景创建出错: ' + (e?.message || e));
        S.loading = false;
      }
    },
    
    onDestroy() {
      if (S.scene) S.scene.destroy();
      S.scene = null;
      S.root = null;
      S.canvasEl = null;
      S.lastUniverseBgPath = '';
      S.lastPlanetBasePath = '';
    }
  };
}
