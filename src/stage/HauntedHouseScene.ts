import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createEmptyBlendshapes } from '../ai/a2fSolver';
import { probeOptimalWebGpuDevice } from '../ai/webgpuCapabilities';
import { DEFAULT_VISUAL_CUE_RULES } from '../orchestrator/piratePersonaBank';
import type {
  BlendshapeWeights,
  MoodTag,
  StageViewMode,
  VisualCueRule,
} from '../types/monster';
import { HellfireAndAtmosphereRig } from './HellfireComputeTSL';
import { SplinteredMouthRig } from './SplinteredMouthRig';

interface FlyingCandyBar {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
}

function createStoneWallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5c4b3b';
  ctx.fillRect(0, 0, 512, 512);

  for (let row = 0; row < 10; row++) {
    const y = row * 51.2;
    let x = (row % 2) * -32;
    while (x < 512) {
      const w = 68 + ((row * 31 + x) % 44);
      const shade = 78 + ((row * 19 + Math.abs(x)) % 42);
      ctx.fillStyle = `rgb(${shade + 18}, ${shade + 6}, ${shade - 8})`;
      ctx.fillRect(x + 2, y + 2, w - 4, 47);
      x += w;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWetDrivewayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#252629';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 28 + Math.floor(Math.random() * 20);
    ctx.fillStyle = `rgb(${v}, ${v}, ${v + 3})`;
    ctx.fillRect(x, y, 3, 3);
  }

  // Center expansion joint like `1_hero.png`
  ctx.fillStyle = '#12100e';
  ctx.fillRect(250, 0, 12, 512);
  ctx.fillRect(0, 252, 512, 6);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Complete WebGPU 3D Haunted Pirate-Galleon House Scene.
 * Upgrades MonsterHouse's visuals with real-time WebGPU lighting, wet driveway reflections,
 * storm sky & harvest moon, flickering porch lanterns, interactive pumpkins, candy barrage VFX,
 * and projector-ready close-up mode.
 */
export class HauntedHouseScene {
  private renderer: WebGPURenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);

  private readonly houseArchitectureGroup = new THREE.Group();
  private readonly mouthRig = new SplinteredMouthRig();
  private readonly hellfireRig = new HellfireAndAtmosphereRig();

  private readonly mawFireLight: THREE.PointLight;
  private readonly mawBounceLight: THREE.PointLight;
  private readonly lightningLight: THREE.DirectionalLight;
  private readonly lanternLights: THREE.PointLight[] = [];
  private readonly pumpkinLights: THREE.PointLight[] = [];
  private readonly pirateSilhouette: THREE.Mesh;

  private readonly candyBars: FlyingCandyBar[] = [];
  private currentWeights: BlendshapeWeights = createEmptyBlendshapes();
  private smoothedWeights: BlendshapeWeights = createEmptyBlendshapes();
  private currentCueRule: VisualCueRule = DEFAULT_VISUAL_CUE_RULES.grumpy;
  private viewMode: StageViewMode = 'house';

  private rafId: number | null = null;
  private lastTimeMs = performance.now();
  private startTimeMs = performance.now();
  private lightningFlash = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private onFpsUpdate?: (fps: number, backendName: string) => void;
  private backendLabel = 'WebGPU';
  private disposed = false;
  private initPromise: Promise<unknown> | null = null;

  constructor(onFpsUpdate?: (fps: number, backendName: string) => void) {
    this.onFpsUpdate = onFpsUpdate;
    this.scene.background = new THREE.Color('#040711');
    this.scene.fog = new THREE.FogExp2('#060a16', 0.032);

    // Position Splintered Garage Door + Hellfire Maw at ground-floor garage opening
    this.mouthRig.root.position.set(0, 1.75, 0);
    this.hellfireRig.fireGroup.position.set(0, 1.75, 0);
    this.scene.add(this.mouthRig.root);
    this.scene.add(this.hellfireRig.fireGroup);
    this.scene.add(this.hellfireRig.atmosphereGroup);

    // Ambient moonlight + storm directional light
    const hemi = new THREE.HemisphereLight('#2a4175', '#1a0e07', 0.55);
    this.scene.add(hemi);

    const moonDir = new THREE.DirectionalLight('#6d8fd6', 0.72);
    moonDir.position.set(8, 14, 9);
    this.scene.add(moonDir);

    this.lightningLight = new THREE.DirectionalLight('#cce6ff', 0.0);
    this.lightningLight.position.set(-7, 16, 6);
    this.scene.add(this.lightningLight);

    // Dynamic roaring hellfire lights inside and in front of the mouth
    this.mawFireLight = new THREE.PointLight('#ff5a00', 6.5, 16, 1.45);
    this.mawFireLight.position.set(0, 1.65, 0.55);
    this.scene.add(this.mawFireLight);

    this.mawBounceLight = new THREE.PointLight('#ff8811', 3.8, 14, 1.6);
    this.mawBounceLight.position.set(0, 0.55, 2.4);
    this.scene.add(this.mawBounceLight);

    // Build full architectural haunted house facade (matches and elevates `1_hero.png`!)
    this.pirateSilhouette = this.buildArchitecture();
    this.scene.add(this.houseArchitectureGroup);

    // Pre-allocate flying candy bars for "GivingIn" / "AnswerPlusCandy" celebrations
    const wrapperColors = [0xd97706, 0x9333ea, 0xdc2626, 0x16a34a, 0x2563eb];
    const barGeo = new THREE.BoxGeometry(0.24, 0.07, 0.11);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: wrapperColors[i % wrapperColors.length],
        metalness: 0.72,
        roughness: 0.24,
        emissive: wrapperColors[i % wrapperColors.length],
        emissiveIntensity: 0.25,
      });
      const mesh = new THREE.Mesh(barGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.candyBars.push({
        mesh,
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
        life: 0,
      });
    }

    this.applyViewMode('house');
  }

  private buildArchitecture(): THREE.Mesh {
    const stoneMat = new THREE.MeshStandardMaterial({
      map: createStoneWallTexture(),
      roughness: 0.85,
      metalness: 0.05,
    });

    const darkSidingMat = new THREE.MeshStandardMaterial({
      color: '#111318',
      roughness: 0.78,
      metalness: 0.12,
    });

    const oakBeamMat = new THREE.MeshStandardMaterial({
      color: '#1f1209',
      roughness: 0.9,
      metalness: 0.1,
    });

    // Left & right stonework garage piers + top parapet
    const leftPier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.1, 1.3), stoneMat);
    leftPier.position.set(-5.0, 2.05, 0.22);
    this.houseArchitectureGroup.add(leftPier);

    const rightPier = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.1, 1.3), stoneMat);
    rightPier.position.set(5.3, 2.05, 0.22);
    this.houseArchitectureGroup.add(rightPier);

    const stoneParapet = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.72, 1.32), stoneMat);
    stoneParapet.position.set(0.3, 3.85, 0.22);
    this.houseArchitectureGroup.add(stoneParapet);

    // Massive salvaged galleon keel lintel beam above the garage mouth
    const lintelBeam = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.34, 0.46), oakBeamMat);
    lintelBeam.position.set(0, 3.55, 0.72);
    this.houseArchitectureGroup.add(lintelBeam);

    // Upper second-story dark timber house + pitched gable roof (`1_hero.png`)
    const upperHouse = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3.1, 3.8), darkSidingMat);
    upperHouse.position.set(-0.2, 5.65, -1.2);
    this.houseArchitectureGroup.add(upperHouse);

    // Glass balcony railing
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#88aacc',
      transparent: true,
      opacity: 0.24,
      roughness: 0.1,
      metalness: 0.2,
    });
    const balconyGlass = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.88, 0.06), glassMat);
    balconyGlass.position.set(-0.1, 4.65, 0.75);
    this.houseArchitectureGroup.add(balconyGlass);

    // Pitched gable roof slopes
    const leftRoof = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.22, 4.4), darkSidingMat);
    leftRoof.position.set(-2.6, 7.65, -1.1);
    leftRoof.rotation.z = 0.26;
    this.houseArchitectureGroup.add(leftRoof);

    const rightRoof = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.22, 4.4), darkSidingMat);
    rightRoof.position.set(2.2, 7.65, -1.1);
    rightRoof.rotation.z = -0.26;
    this.houseArchitectureGroup.add(rightRoof);

    // 4 Upper warm-glowing windows + spooky ghostly captain silhouette
    const windowGlowMat = new THREE.MeshBasicMaterial({
      color: '#c97828',
      transparent: true,
      opacity: 0.52,
    });
    for (let w = 0; w < 4; w++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.35), windowGlowMat);
      win.position.set(-2.95 + w * 1.85, 5.55, 0.72);
      this.houseArchitectureGroup.add(win);
    }

    const silhouetteMat = new THREE.MeshBasicMaterial({
      color: '#070504',
      transparent: true,
      opacity: 0.72,
    });
    const silhouette = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.45, 6), silhouetteMat);
    silhouette.position.set(-1.1, 5.1, 0.74);
    this.houseArchitectureGroup.add(silhouette);

    // Warm porch wall sconces + Uplights on stonework
    const sconcePositions = [-4.6, 4.6];
    for (const sx of sconcePositions) {
      const sconceBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.42, 0.22),
        new THREE.MeshBasicMaterial({ color: '#ffbb55' }),
      );
      sconceBox.position.set(sx, 2.85, 0.92);
      this.houseArchitectureGroup.add(sconceBox);

      const light = new THREE.PointLight('#ff9a2e', 3.4, 8.5, 1.7);
      light.position.set(sx, 2.65, 1.25);
      this.houseArchitectureGroup.add(light);
      this.lanternLights.push(light);
    }

    // Interactive Porch Jack-o'-Lanterns flanking the driveway
    const pumpkinMat = new THREE.MeshStandardMaterial({
      color: '#d9530f',
      roughness: 0.65,
      emissive: '#ff6600',
      emissiveIntensity: 0.45,
    });
    for (const px of [-4.15, 4.15]) {
      const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), pumpkinMat);
      pumpkin.scale.set(1.15, 0.85, 1.15);
      pumpkin.position.set(px, 0.28, 1.28);
      this.houseArchitectureGroup.add(pumpkin);

      const pLight = new THREE.PointLight('#ff7700', 1.8, 4.5, 1.8);
      pLight.position.set(px, 0.45, 1.5);
      this.houseArchitectureGroup.add(pLight);
      this.pumpkinLights.push(pLight);
    }

    // Wet Rain-Slick Driveway Apron catching fire reflections!
    const drivewayMat = new THREE.MeshStandardMaterial({
      map: createWetDrivewayTexture(),
      roughness: 0.16,
      metalness: 0.55,
    });
    const driveway = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), drivewayMat);
    driveway.rotation.x = -Math.PI / 2;
    driveway.position.set(0, 0, 6.2);
    this.houseArchitectureGroup.add(driveway);

    // Full Harvest Moon in the upper right storm sky (`1_hero.png`)
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 32),
      new THREE.MeshBasicMaterial({ color: '#e8eefc' }),
    );
    moon.position.set(8.2, 9.4, -12);
    this.houseArchitectureGroup.add(moon);

    return silhouette;
  }

  async mount(container: HTMLElement): Promise<void> {
    this.disposed = false;
    const width = Math.max(320, container.clientWidth || 960);
    const height = Math.max(220, container.clientHeight || 420);

    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        p.catch(() => fallback),
        new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms)),
      ]);

    const caps = await probeOptimalWebGpuDevice(600);
    if (this.disposed) return;

    let useNativeWebGpu = caps.hasHardwareWebGpu;

    let renderer = new WebGPURenderer({
      antialias: true,
      powerPreference: 'high-performance',
      forceWebGL: !useNativeWebGpu,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const pendingInit = renderer.init();
    this.initPromise = pendingInit;
    const initOk = await withTimeout(
      pendingInit.then(() => true),
      1500,
      false,
    );
    this.initPromise = null;

    if (this.disposed) {
      renderer.dispose();
      return;
    }

    if (!initOk) {
      renderer.dispose();
      useNativeWebGpu = false;
      renderer = new WebGPURenderer({
        antialias: true,
        forceWebGL: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      const fallbackInit = renderer.init();
      this.initPromise = fallbackInit;
      await fallbackInit;
      this.initPromise = null;
    }

    if (this.disposed) {
      renderer.dispose();
      return;
    }

    this.backendLabel = useNativeWebGpu ? 'WebGPU Native (TSL)' : 'TSL Node (WebGL2 Fallback)';
    this.onFpsUpdate?.(60, this.backendLabel);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.lastTimeMs = performance.now();
    this.startTimeMs = this.lastTimeMs;
    this.loop();
  }

  resize(width: number, height: number): void {
    if (!this.renderer || width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  applyViewMode(mode: StageViewMode): void {
    this.viewMode = mode;
    if (mode === 'projector') {
      // Pure black masked garage-door projection mode!
      this.houseArchitectureGroup.visible = false;
      this.scene.background = new THREE.Color('#000000');
      this.scene.fog = null;
      this.camera.position.set(0, 1.72, 5.15);
      this.camera.lookAt(0, 1.68, 0);
    } else if (mode === 'closeup') {
      this.houseArchitectureGroup.visible = true;
      this.scene.background = new THREE.Color('#040711');
      this.scene.fog = new THREE.FogExp2('#060a16', 0.032);
      this.camera.position.set(0, 1.78, 5.65);
      this.camera.lookAt(0, 1.68, 0);
    } else {
      // Full Architectural Haunted House View
      this.houseArchitectureGroup.visible = true;
      this.scene.background = new THREE.Color('#040711');
      this.scene.fog = new THREE.FogExp2('#060a16', 0.028);
      this.camera.position.set(0, 2.75, 11.4);
      this.camera.lookAt(0, 2.85, 0);
    }
  }

  setBlendshapes(weights: BlendshapeWeights): void {
    this.currentWeights = weights;
  }

  setMoodCue(mood: MoodTag, rule?: VisualCueRule): void {
    const resolved = rule ?? DEFAULT_VISUAL_CUE_RULES[mood];
    this.currentCueRule = resolved;
    this.hellfireRig.applyCueRule(resolved);
    this.mouthRig.setEmberColor(resolved.fireSecondaryHex);
    if (resolved.lightningChance > 0.3 && Math.random() < resolved.lightningChance) {
      this.lightningFlash = 1.0;
    }
  }

  triggerCandyBarrage(): void {
    this.hellfireRig.burstCelebrationSparks();
    for (let i = 0; i < this.candyBars.length; i++) {
      const c = this.candyBars[i];
      c.mesh.visible = true;
      c.mesh.position.set((Math.random() - 0.5) * 2.4, 1.55, 0.25);
      c.vel.set(
        (Math.random() - 0.5) * 3.4,
        2.2 + Math.random() * 2.6,
        2.5 + Math.random() * 3.8,
      );
      c.rotVel.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      );
      c.life = 2.8;
    }
  }

  private loop = (): void => {
    if (this.disposed || !this.renderer) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimeMs) / 1000));
    this.lastTimeMs = now;
    const elapsedSec = (now - this.startTimeMs) / 1000;

    // Smooth blendshape interpolation for locked 60-120Hz fluidity
    const lerpAlpha = Math.min(1, dt * 28);
    for (const key of Object.keys(this.currentWeights) as Array<keyof BlendshapeWeights>) {
      const curr = this.smoothedWeights[key] ?? 0;
      const target = this.currentWeights[key] ?? 0;
      this.smoothedWeights[key] = curr + (target - curr) * lerpAlpha;
    }

    const aperture = this.mouthRig.updateFromBlendshapes(this.smoothedWeights, elapsedSec);
    this.hellfireRig.update(dt, elapsedSec, aperture, this.camera.position);

    // Dynamic firelight intensity & color synced to mouth opening + flame flicker
    const flicker = 0.88 + 0.18 * Math.sin(elapsedSec * 19.3) + 0.1 * Math.cos(elapsedSec * 31.7);
    this.mawFireLight.color.set(this.currentCueRule.firePrimaryHex);
    this.mawBounceLight.color.set(this.currentCueRule.fireSecondaryHex);
    this.mawFireLight.intensity = (2.8 + aperture * 11.5) * flicker;
    this.mawBounceLight.intensity = (1.4 + aperture * 7.8) * flicker;

    // Lantern & porch pumpkin flicker
    for (let i = 0; i < this.lanternLights.length; i++) {
      this.lanternLights[i].intensity = 3.1 + 0.35 * Math.sin(elapsedSec * 7.5 + i * 2.1);
    }
    for (let i = 0; i < this.pumpkinLights.length; i++) {
      this.pumpkinLights[i].intensity =
        1.6 + aperture * 1.9 + 0.35 * Math.sin(elapsedSec * 11.2 + i);
    }

    // Upper window ghostly captain drift + distant lightning decay
    this.pirateSilhouette.position.x = -0.8 + Math.sin(elapsedSec * 0.35) * 1.45;
    if (this.lightningFlash > 0.01) {
      this.lightningLight.intensity = this.lightningFlash * 5.5;
      this.lightningFlash *= Math.pow(0.04, dt);
    } else {
      this.lightningLight.intensity = 0;
    }

    // Subtle handheld cinematic breathing in Full House mode
    if (this.viewMode === 'house') {
      this.camera.position.x = Math.sin(elapsedSec * 0.28) * 0.18;
      this.camera.position.y = 2.75 + Math.cos(elapsedSec * 0.37) * 0.06;
      this.camera.lookAt(0, 2.55, 0);
    }

    // Simulate flying candy bars
    for (const c of this.candyBars) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.visible = false;
        continue;
      }
      c.vel.y -= 9.2 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.rotVel.x * dt;
      c.mesh.rotation.y += c.rotVel.y * dt;
      c.mesh.rotation.z += c.rotVel.z * dt;
      if (c.mesh.position.y < 0.05) {
        c.mesh.position.y = 0.05;
        c.vel.y = Math.abs(c.vel.y) * 0.42;
        c.vel.x *= 0.75;
        c.vel.z *= 0.75;
      }
    }

    this.renderer.render(this.scene, this.camera);

    // FPS reporting every 0.75s
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.75) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.onFpsUpdate?.(fps, this.backendLabel);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const r = this.renderer;
    this.renderer = null;
    if (r) {
      if (this.initPromise) {
        void this.initPromise.finally(() => r.dispose());
      } else {
        r.dispose();
      }
    }
  }
}
