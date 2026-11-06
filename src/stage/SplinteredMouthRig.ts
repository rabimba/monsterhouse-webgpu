import * as THREE from 'three';
import type { BlendshapeWeights } from '../types/monster';

interface PlankTooth {
  upperGroup: THREE.Group;
  lowerGroup: THREE.Group;
  upperTipEmber: THREE.Mesh;
  lowerTipEmber: THREE.Mesh;
  /** Normalized horizontal coordinate in [-1, 1] across the mouth width */
  u: number;
  /** Organic jagged length asymmetry */
  upperFangLen: number;
  lowerFangLen: number;
  seed: number;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function createWeatheredPlankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1b110b';
  ctx.fillRect(0, 0, 512, 512);

  // Deep sunken-galleon vertical wood grain & knots
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 4;
    const shade = Math.floor(14 + Math.random() * 26);
    ctx.fillStyle = `rgb(${shade + 8}, ${shade}, ${Math.max(4, shade - 6)})`;
    ctx.fillRect(x, 0, w, 512);
  }

  // Plank seam grooves
  ctx.fillStyle = '#090604';
  for (let x = 0; x < 512; x += 64) {
    ctx.fillRect(x, 0, 3, 512);
  }

  // Subtle sea-salt weathering & iron bolt stains
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 4 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(10, 7, 5, 0.65)');
    g.addColorStop(1, 'rgba(10, 7, 5, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 3D Procedural Sunken-Pirate-Ship Garage Door & Jagged Splintered Mouth Rig.
 * Deforms 26 split oak planks and charred inner fangs across all 44 active ARKit sound targets.
 */
export class SplinteredMouthRig {
  public readonly root = new THREE.Group();
  private readonly planks: PlankTooth[] = [];
  private readonly outerStaticPlanks: THREE.Mesh[] = [];
  private readonly magmaTongue: THREE.Mesh;
  private readonly emberMaterial: THREE.MeshBasicMaterial;
  private readonly doorWidth = 7.4;
  private readonly doorHeight = 3.5;

  constructor() {
    const woodTex = createWeatheredPlankTexture();

    const plankMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.88,
      metalness: 0.08,
      color: new THREE.Color('#2a1b12'),
    });

    const charredInnerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#120804'),
      roughness: 0.95,
      emissive: new THREE.Color('#4a1200'),
      emissiveIntensity: 0.55,
    });

    this.emberMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff7b00'),
    });

    const totalPlanks = 32;
    const plankW = this.doorWidth / totalPlanks;
    const mouthSpanPlanks = 24; // Central 24 planks form the cursed jagged mouth
    const startMouthIdx = Math.floor((totalPlanks - mouthSpanPlanks) / 2);
    const endMouthIdx = startMouthIdx + mouthSpanPlanks - 1;

    for (let i = 0; i < totalPlanks; i++) {
      const centerX = -this.doorWidth / 2 + (i + 0.5) * plankW;

      if (i < startMouthIdx || i > endMouthIdx) {
        // Solid outer garage door planks with rusted ship rivets
        const geo = new THREE.BoxGeometry(plankW * 0.95, this.doorHeight, 0.14);
        const mesh = new THREE.Mesh(geo, plankMat);
        mesh.position.set(centerX, 0, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.outerStaticPlanks.push(mesh);
        continue;
      }

      const u = ((i - startMouthIdx) / (mouthSpanPlanks - 1)) * 2 - 1; // -1 .. +1
      const seed = i * 17.31 + 3.7;
      const r1 = pseudoRandom(seed);
      const r2 = pseudoRandom(seed + 9.2);

      // Baseline sinister pirate curve (slightly upturned wicked grin corners like `1_hero.png`)
      const splitCenterY = -0.18 + 0.34 * u * u;
      const upperBaseHeight = this.doorHeight / 2 - splitCenterY;
      const lowerBaseHeight = splitCenterY - -this.doorHeight / 2;

      const envelope = Math.cos(u * Math.PI * 0.48);
      const upperFangLen = (0.18 + r1 * 0.42) * envelope;
      const lowerFangLen = (0.18 + r2 * 0.44) * envelope;

      // Upper plank pivoted near upper lintel/lip line
      const upperGroup = new THREE.Group();
      upperGroup.position.set(centerX, splitCenterY, 0);

      const upperBodyGeo = new THREE.BoxGeometry(plankW * 0.94, upperBaseHeight, 0.14);
      upperBodyGeo.translate(0, upperBaseHeight / 2, 0);
      const upperBody = new THREE.Mesh(upperBodyGeo, plankMat);
      upperGroup.add(upperBody);

      // Jagged splintered wooden fang pointing down
      const upperFangGeo = new THREE.ConeGeometry(plankW * 0.56, upperFangLen, 4);
      upperFangGeo.rotateX(Math.PI);
      upperFangGeo.rotateY(Math.PI * 0.25 + (r1 - 0.5) * 0.3);
      upperFangGeo.translate(0, -upperFangLen * 0.42, 0.01);
      const upperFang = new THREE.Mesh(upperFangGeo, charredInnerMat);
      upperGroup.add(upperFang);

      // Glowing charred splinter tip
      const upperEmberGeo = new THREE.ConeGeometry(plankW * 0.28, upperFangLen * 0.42, 4);
      upperEmberGeo.rotateX(Math.PI);
      upperEmberGeo.translate(0, -upperFangLen * 0.72, 0.02);
      const upperTipEmber = new THREE.Mesh(upperEmberGeo, this.emberMaterial);
      upperGroup.add(upperTipEmber);

      // Lower plank pivoted at split line
      const lowerGroup = new THREE.Group();
      lowerGroup.position.set(centerX, splitCenterY, 0);

      const lowerBodyGeo = new THREE.BoxGeometry(plankW * 0.94, lowerBaseHeight, 0.14);
      lowerBodyGeo.translate(0, -lowerBaseHeight / 2, 0);
      const lowerBody = new THREE.Mesh(lowerBodyGeo, plankMat);
      lowerGroup.add(lowerBody);

      // Jagged splintered wooden fang pointing up
      const lowerFangGeo = new THREE.ConeGeometry(plankW * 0.56, lowerFangLen, 4);
      lowerFangGeo.rotateY(Math.PI * 0.25 + (r2 - 0.5) * 0.3);
      lowerFangGeo.translate(0, lowerFangLen * 0.42, 0.01);
      const lowerFang = new THREE.Mesh(lowerFangGeo, charredInnerMat);
      lowerGroup.add(lowerFang);

      const lowerEmberGeo = new THREE.ConeGeometry(plankW * 0.28, lowerFangLen * 0.42, 4);
      lowerEmberGeo.translate(0, lowerFangLen * 0.72, 0.02);
      const lowerTipEmber = new THREE.Mesh(lowerEmberGeo, this.emberMaterial);
      lowerGroup.add(lowerTipEmber);

      this.root.add(upperGroup);
      this.root.add(lowerGroup);

      this.planks.push({
        upperGroup,
        lowerGroup,
        upperTipEmber,
        lowerTipEmber,
        u,
        upperFangLen,
        lowerFangLen,
        seed,
      });
    }

    // Inner licking magma tongue driven by `tongueOut` + `jawOpen`
    const tongueGeo = new THREE.ConeGeometry(0.55, 1.35, 7);
    tongueGeo.rotateZ(-Math.PI * 0.5);
    tongueGeo.scale(1.2, 0.38, 0.85);
    const tongueMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffaa11'),
      transparent: true,
      opacity: 0.85,
    });
    this.magmaTongue = new THREE.Mesh(tongueGeo, tongueMat);
    this.magmaTongue.position.set(0, -0.32, -0.35);
    this.root.add(this.magmaTongue);
  }

  setEmberColor(hex: string): void {
    this.emberMaterial.color.set(hex);
  }

  /**
   * Updates all 24 split ship-plank jaws using the 44 active ARKit sound targets.
   * Returns current central jaw aperture (0..1.5) for driving compute fire & bounce light.
   */
  updateFromBlendshapes(w: BlendshapeWeights, elapsedSec: number): number {
    const idleBreath = 0.11 + 0.04 * Math.sin(elapsedSec * 1.9);

    const jawOpen = Math.max(idleBreath, w.jawOpen ?? 0);
    const jawForward = w.jawForward ?? 0;
    const jawLeft = w.jawLeft ?? 0;
    const jawRight = w.jawRight ?? 0;
    const mouthClose = w.mouthClose ?? 0;
    const funnel = w.mouthFunnel ?? 0;
    const pucker = w.mouthPucker ?? 0;
    const smileL = w.mouthSmileLeft ?? 0;
    const smileR = w.mouthSmileRight ?? 0;
    const frownL = w.mouthFrownLeft ?? 0;
    const frownR = w.mouthFrownRight ?? 0;
    const stretchL = w.mouthStretchLeft ?? 0;
    const stretchR = w.mouthStretchRight ?? 0;
    const upperUpL = w.mouthUpperUpLeft ?? 0;
    const upperUpR = w.mouthUpperUpRight ?? 0;
    const lowerDownL = w.mouthLowerDownLeft ?? 0;
    const lowerDownR = w.mouthLowerDownRight ?? 0;
    const sneerL = w.noseSneerLeft ?? 0;
    const sneerR = w.noseSneerRight ?? 0;
    const rollUpper = w.mouthRollUpper ?? 0;
    const rollLower = w.mouthRollLower ?? 0;
    const shrugUpper = w.mouthShrugUpper ?? 0;
    const shrugLower = w.mouthShrugLower ?? 0;
    const browDown = ((w.browDownLeft ?? 0) + (w.browDownRight ?? 0)) * 0.5;
    const browUp = w.browInnerUp ?? 0;
    const cheekPuff = w.cheekPuff ?? 0;
    const tongueOut = w.tongueOut ?? 0;

    // Pucker & Funnel narrow the active horizontal aperture; Stretch widens it
    const widthFactor = Math.max(
      0.42,
      Math.min(1.18, 1.0 - pucker * 0.46 - funnel * 0.25 + (stretchL + stretchR) * 0.16),
    );

    const effectiveOpen = Math.max(0.02, jawOpen * (1 - mouthClose * 0.68) + funnel * 0.22);
    const lateralShift = (jawRight - jawLeft) * 0.24 + ((w.mouthRight ?? 0) - (w.mouthLeft ?? 0)) * 0.16;

    for (const p of this.planks) {
      const absU = Math.abs(p.u);
      // Aperture profile shaped by pucker/funnel width factor
      const normalizedU = Math.min(1, absU / widthFactor);
      const arch = Math.pow(Math.max(0, Math.cos(normalizedU * Math.PI * 0.5)), 0.78);

      // Left (-1) vs Right (+1) side weights
      const leftWeight = Math.max(0, -p.u);
      const rightWeight = Math.max(0, p.u);

      const cornerCurl =
        leftWeight * (smileL * 0.36 - frownL * 0.32) +
        rightWeight * (smileR * 0.36 - frownR * 0.32);

      const upperSnarl =
        leftWeight * (upperUpL * 0.26 + sneerL * 0.18) +
        rightWeight * (upperUpR * 0.26 + sneerR * 0.18) +
        (1 - absU) * (shrugUpper * 0.16 + browUp * 0.08 - browDown * 0.06);

      const lowerDrop =
        leftWeight * lowerDownL * 0.28 +
        rightWeight * lowerDownR * 0.28 -
        (1 - absU) * shrugLower * 0.12;

      const baseSplitY = -0.18 + 0.34 * p.u * p.u + cornerCurl;
      const microCreak = Math.sin(elapsedSec * 23 + p.seed) * effectiveOpen * 0.012;

      const upperLift = (effectiveOpen * 0.56 + upperSnarl) * arch + microCreak;
      const lowerDip = (effectiveOpen * 0.72 + lowerDrop) * arch - microCreak;

      p.upperGroup.position.y = baseSplitY + upperLift;
      p.lowerGroup.position.y = baseSplitY - lowerDip;

      p.lowerGroup.position.x =
        (p.u * (this.doorWidth * (24 / 32) * 0.5)) + lateralShift * arch;

      // Plank outward bowing (splintered lips curling out like MonsterHouse's 3D Maya rig!)
      const forwardBow =
        (effectiveOpen * 0.22 + jawForward * 0.18 + funnel * 0.2 + cheekPuff * 0.12) * arch;
      p.upperGroup.position.z = forwardBow * (1 - rollUpper * 0.45);
      p.lowerGroup.position.z = forwardBow * (1.15 - rollLower * 0.45);

      p.upperGroup.rotation.x = -(effectiveOpen * 0.26 - rollUpper * 0.22) * arch;
      p.lowerGroup.rotation.x = (effectiveOpen * 0.32 - rollLower * 0.22) * arch;
      p.upperGroup.rotation.z = -p.u * (smileL + smileR - frownL - frownR) * 0.08;

      const emberScale = 0.65 + effectiveOpen * 0.85;
      p.upperTipEmber.scale.setScalar(emberScale);
      p.lowerTipEmber.scale.setScalar(emberScale);
    }

    // Licking magma tongue inside the maw
    this.magmaTongue.visible = effectiveOpen > 0.14;
    this.magmaTongue.position.z = -0.45 + tongueOut * 0.55 + effectiveOpen * 0.18;
    this.magmaTongue.position.y = -0.26 - effectiveOpen * 0.15 + Math.sin(elapsedSec * 9.5) * 0.04;
    this.magmaTongue.scale.set(
      0.7 + effectiveOpen * 0.65,
      0.28 + tongueOut * 0.35,
      0.75,
    );

    return effectiveOpen;
  }
}
