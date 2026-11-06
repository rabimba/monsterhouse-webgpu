import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  cos,
  float,
  mix,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { VisualCueRule } from '../types/monster';

interface EmberParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
}

function makeRadialGlowTexture(innerRgba: string, midRgba: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, innerRgba);
  g.addColorStop(0.42, midRgba);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * WebGPU TSL Volumetric Hellfire Maw + GPU Instanced Ember Eruption + Rolling Ground Fog.
 */
export class HellfireAndAtmosphereRig {
  public readonly fireGroup = new THREE.Group();
  public readonly atmosphereGroup = new THREE.Group();

  private readonly uPrimaryColor = uniform(new THREE.Color('#ff5500'));
  private readonly uSecondaryColor = uniform(new THREE.Color('#ffaa00'));
  private readonly uRimColor = uniform(new THREE.Color('#ff3300'));
  private readonly uAperture = uniform(0.15);
  private readonly uTurbulence = uniform(1.0);

  private readonly targetPrimary = new THREE.Color('#ff5500');
  private readonly targetSecondary = new THREE.Color('#ffaa00');
  private readonly targetRim = new THREE.Color('#ff3300');
  private targetTurbulence = 1.0;
  private emberRateMult = 1.0;

  private readonly emberMesh: THREE.InstancedMesh;
  private readonly embers: EmberParticle[] = [];
  private readonly dummy = new THREE.Object3D();

  private readonly fogPlanes: Array<{ mesh: THREE.Mesh; speed: number; baseX: number }> = [];

  constructor() {
    // 1. Multi-depth TSL Volumetric Hellfire Sheets inside the garage cavern
    const layerDepths = [-0.24, -0.52, -0.88];
    layerDepths.forEach((zDepth, idx) => {
      const layerOffset = float(idx * 2.17);
      const fireMat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const fireShader = Fn(() => {
        const st = uv();
        const t = time.mul(float(2.6)).mul(this.uTurbulence).add(layerOffset);

        // Domain-warped multi-octave trigonometric turbulence rising upward
        const xCoord = st.x.sub(0.5).mul(6.5);
        const yCoord = st.y.mul(4.5).sub(t);

        const n1 = sin(xCoord.mul(2.1).add(sin(yCoord.mul(1.7).add(t.mul(0.6)))));
        const n2 = cos(yCoord.mul(3.3).sub(sin(xCoord.mul(3.9).sub(t)))).mul(0.55);
        const n3 = sin(xCoord.mul(7.3).add(yCoord.mul(5.7)).sub(t.mul(1.8))).mul(0.28);
        const n4 = cos(xCoord.mul(13.1).sub(yCoord.mul(9.4)).add(t.mul(2.5))).mul(0.15);

        const flameField = n1.add(n2).add(n3).add(n4).mul(0.35).add(0.58);

        // Concentrate fire toward center of the mouth and roar brighter as jaw opens
        const horizMask = smoothstep(float(0.52), float(0.08), st.x.sub(0.5).abs());
        const vertMask = smoothstep(float(0.0), float(0.24), st.y).mul(
          smoothstep(float(1.0), float(0.22), st.y),
        );

        const openBoost = float(0.42).add(this.uAperture.mul(1.15));
        const intensity = flameField.mul(horizMask).mul(vertMask).mul(openBoost);

        const coreMix = smoothstep(float(0.28), float(0.78), intensity);
        const whiteHotMix = smoothstep(float(0.68), float(1.05), intensity);

        const baseCol = mix(this.uRimColor, this.uPrimaryColor, smoothstep(float(0.08), float(0.45), intensity));
        const midCol = mix(baseCol, this.uSecondaryColor, coreMix);
        const finalRgb = mix(midCol, vec3(1.0, 0.97, 0.86), whiteHotMix.mul(0.75));
        const alpha = smoothstep(float(0.06), float(0.48), intensity).mul(float(idx === 0 ? 0.95 : 0.72));

        return vec4(finalRgb, alpha);
      });

      fireMat.colorNode = fireShader();

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 3.1, 1, 1), fireMat);
      plane.position.set(0, -0.08, zDepth);
      this.fireGroup.add(plane);
    });

    // Deep charred furnace backwall behind the flames so exterior light never leaks through
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 3.45),
      new THREE.MeshBasicMaterial({ color: 0x090200 }),
    );
    backWall.position.set(0, 0, -1.25);
    this.fireGroup.add(backWall);

    // 2. Instanced Flying Cinders & Embers erupting onto the wet driveway
    const emberCount = 420;
    const emberGeo = new THREE.PlaneGeometry(0.065, 0.065);
    const emberMat = new THREE.MeshBasicMaterial({
      map: makeRadialGlowTexture('rgba(255,250,210,1)', 'rgba(255,115,15,0.85)'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.emberMesh = new THREE.InstancedMesh(emberGeo, emberMat, emberCount);
    this.emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.atmosphereGroup.add(this.emberMesh);

    for (let i = 0; i < emberCount; i++) {
      this.embers.push({
        pos: new THREE.Vector3(0, -10, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        scale: 1,
      });
    }

    // 3. Volumetric Low-Lying Driveway Ground Fog
    const fogTex = makeRadialGlowTexture('rgba(195, 205, 225, 0.16)', 'rgba(130, 145, 175, 0.06)');
    for (let i = 0; i < 14; i++) {
      const fogMat = new THREE.MeshBasicMaterial({
        map: fogTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      });
      const w = 4.8 + (i % 4) * 1.4;
      const fogMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.65), fogMat);
      const baseX = -6.5 + (i / 13) * 13.0;
      fogMesh.position.set(baseX, -1.32 + (i % 3) * 0.14, 1.3 + (i % 5) * 0.85);
      this.atmosphereGroup.add(fogMesh);
      this.fogPlanes.push({
        mesh: fogMesh,
        speed: (i % 2 === 0 ? 1 : -1) * (0.14 + (i % 4) * 0.05),
        baseX,
      });
    }
  }

  applyCueRule(rule: VisualCueRule): void {
    this.targetPrimary.set(rule.firePrimaryHex);
    this.targetSecondary.set(rule.fireSecondaryHex);
    this.targetRim.set(rule.rimGlowHex);
    this.targetTurbulence = rule.turbulence;
    this.emberRateMult = rule.emberRateMultiplier;
  }

  burstCelebrationSparks(): void {
    let spawned = 0;
    for (const p of this.embers) {
      if (p.life <= 0 && spawned < 95) {
        p.pos.set((Math.random() - 0.5) * 3.8, 1.65 + (Math.random() - 0.5) * 0.4, 0.18);
        p.vel.set(
          (Math.random() - 0.5) * 3.8,
          1.2 + Math.random() * 2.8,
          1.6 + Math.random() * 3.4,
        );
        p.maxLife = 1.2 + Math.random() * 1.3;
        p.life = p.maxLife;
        p.scale = 1.4 + Math.random() * 1.2;
        spawned++;
      }
    }
  }

  update(dt: number, elapsedSec: number, jawAperture: number, cameraPos: THREE.Vector3): void {
    // Smoothly interpolate TSL fire mood uniforms
    this.uPrimaryColor.value.lerp(this.targetPrimary, Math.min(1, dt * 4.5));
    this.uSecondaryColor.value.lerp(this.targetSecondary, Math.min(1, dt * 4.5));
    this.uRimColor.value.lerp(this.targetRim, Math.min(1, dt * 4.5));
    this.uAperture.value = jawAperture;
    this.uTurbulence.value += (this.targetTurbulence - this.uTurbulence.value) * Math.min(1, dt * 4);

    // Spawn & simulate cinders erupting out of the garage mouth (world Y center of garage is +1.75)
    const spawnBudget = Math.ceil((1 + jawAperture * 12) * this.emberRateMult * dt * 60 * 0.35);
    let spawnedThisTick = 0;

    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      if (e.life <= 0) {
        if (spawnedThisTick < spawnBudget && jawAperture > 0.045) {
          const spreadX = (Math.random() - 0.5) * 4.4 * Math.min(1, 0.35 + jawAperture);
          e.pos.set(spreadX, 1.55 + (Math.random() - 0.5) * jawAperture * 0.65, 0.08);
          e.vel.set(
            spreadX * 0.35 + (Math.random() - 0.5) * 1.2,
            0.35 + Math.random() * 1.65 * jawAperture,
            0.85 + Math.random() * 2.9 * (0.4 + jawAperture),
          );
          e.maxLife = 0.85 + Math.random() * 1.45;
          e.life = e.maxLife;
          e.scale = 0.6 + Math.random() * 1.35;
          spawnedThisTick++;
        } else {
          this.dummy.position.set(0, -50, 0);
          this.dummy.scale.setScalar(0.001);
          this.dummy.updateMatrix();
          this.emberMesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }
      }

      e.life -= dt;
      // Buoyancy + turbulent crosswind + driveway bounce at y = 0.03
      e.vel.y -= 1.65 * dt;
      e.vel.x += Math.sin(elapsedSec * 3.1 + i) * 0.55 * dt;
      e.pos.addScaledVector(e.vel, dt);

      if (e.pos.y < 0.04) {
        e.pos.y = 0.04;
        e.vel.y = Math.abs(e.vel.y) * 0.38;
        e.vel.x *= 0.82;
        e.vel.z *= 0.82;
      }

      const lifeRatio = Math.max(0, e.life / e.maxLife);
      this.dummy.position.copy(e.pos);
      this.dummy.lookAt(cameraPos);
      this.dummy.scale.setScalar(e.scale * Math.sin(lifeRatio * Math.PI));
      this.dummy.updateMatrix();
      this.emberMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.emberMesh.instanceMatrix.needsUpdate = true;

    // Drift ground mist across the wet driveway
    for (const f of this.fogPlanes) {
      f.mesh.position.x = f.baseX + Math.sin(elapsedSec * f.speed + f.baseX) * 1.65;
    }
  }
}
