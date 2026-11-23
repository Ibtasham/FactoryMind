import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Grid2x2,
  Layers,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  MachineVisualStatus,
  TwinMaterialFlow,
  VISUAL_INDICATOR_SPECS,
} from '../../engine/digitalTwin';
import {
  buildAssembly3D,
  buildPlantFloorTwin,
  BuiltSceneRoot,
  PartUserData,
  PlantRackProductInput,
  PlantStationInput,
  updatePlantFloorTwin,
} from '../../engine/threeModels';
import {
  ASSEMBLY_CAMERA_PRESETS,
  AssemblySku,
  CameraPresetId,
  FINISH_PRESETS,
  FinishPresetId,
  PLANT_CAMERA_PRESETS,
  SceneModeId,
} from '../../engine/threeSpecs';
import { DigitalTwin2DFallback } from './DigitalTwin2DFallback';

export interface Selected3DPart {
  partId: string;
  label: string;
  sku: string;
  qtyPer?: number;
  role: string;
  stationNumber?: number;
  rackCode?: string;
  machineState?: MachineVisualStatus;
}

export interface Factory3DViewportProps {
  mode: SceneModeId;
  assemblySku: AssemblySku;
  plantProducts: PlantRackProductInput[];
  plantStations: PlantStationInput[];
  explodeAmount: number;
  onExplodeChange?: (v: number) => void;
  finish: FinishPresetId;
  onFinishChange?: (f: FinishPresetId) => void;
  selectedPartId?: string | null;
  onSelectPart?: (part: Selected3DPart | null) => void;
  theme?: 'dark' | 'light';
  reduceMotion?: boolean;
  compact?: boolean;
  className?: string;
  // Enhanced Digital Twin Simulation & Fallback Controls (backward-compatible optional)
  simPlaying?: boolean;
  onSimPlayingChange?: (playing: boolean) => void;
  simSpeed?: 0.5 | 1 | 2;
  onSimSpeedChange?: (speed: 0.5 | 1 | 2) => void;
  plantFlows?: TwinMaterialFlow[];
  focusTargetId?: string | null;
  renderMode?: '3d' | '2d';
  onRenderModeChange?: (mode: '3d' | '2d') => void;
}

function detectSoftwareWebGL(): { supported: boolean; isSoftwareGl: boolean } {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      const gl1 = canvas.getContext('webgl');
      if (!gl1) return { supported: false, isSoftwareGl: false };
      const lose1 = gl1.getExtension('WEBGL_lose_context');
      lose1?.loseContext();
      return { supported: true, isSoftwareGl: false };
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return { supported: true, isSoftwareGl };
  } catch {
    return { supported: false, isSoftwareGl: false };
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 14, 128, 128, 124);
    grad.addColorStop(0, 'rgba(2, 6, 23, 0.42)');
    grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.16)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
}

export const Factory3DViewport: React.FC<Factory3DViewportProps> = ({
  mode,
  assemblySku,
  plantProducts,
  plantStations,
  explodeAmount,
  onExplodeChange,
  finish,
  onFinishChange,
  selectedPartId,
  onSelectPart,
  theme = 'dark',
  reduceMotion = false,
  compact = false,
  className = '',
  simPlaying: controlledSimPlaying,
  onSimPlayingChange,
  simSpeed: controlledSimSpeed,
  onSimSpeedChange,
  plantFlows = [],
  focusTargetId = null,
  renderMode: controlledRenderMode,
  onRenderModeChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [hoveredPart, setHoveredPart] = useState<Selected3DPart | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(compact);
  const [autoSpin, setAutoSpin] = useState(!compact && !reduceMotion && mode === 'assembly');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('iso');

  const [internalSimPlaying, setInternalSimPlaying] = useState<boolean>(!reduceMotion);
  const [internalSimSpeed, setInternalSimSpeed] = useState<0.5 | 1 | 2>(1);
  const [internalRenderMode, setInternalRenderMode] = useState<'3d' | '2d'>('3d');

  const simPlaying = controlledSimPlaying ?? internalSimPlaying;
  const simSpeed = controlledSimSpeed ?? internalSimSpeed;
  const requestedRenderMode = controlledRenderMode ?? internalRenderMode;
  const effectiveRenderMode: '3d' | '2d' = contextError ? '2d' : requestedRenderMode;

  const setSimPlaying = (next: boolean) => {
    if (controlledSimPlaying === undefined) setInternalSimPlaying(next);
    onSimPlayingChange?.(next);
  };

  const cycleSimSpeed = () => {
    const next: 0.5 | 1 | 2 = simSpeed === 1 ? 2 : simSpeed === 2 ? 0.5 : 1;
    if (controlledSimSpeed === undefined) setInternalSimSpeed(next);
    onSimSpeedChange?.(next);
  };

  const toggleRenderMode = () => {
    const next: '3d' | '2d' = effectiveRenderMode === '3d' ? '2d' : '3d';
    if (controlledRenderMode === undefined) setInternalRenderMode(next);
    onRenderModeChange?.(next);
  };

  // Refs synced cleanly to imperative Three.js scene without rebuilding WebGLRenderer
  const explodeTargetRef = useRef(explodeAmount);
  const explodeCurrentRef = useRef(explodeAmount);
  const selectedPartIdRef = useRef(selectedPartId || null);
  const hoveredPartIdRef = useRef<string | null>(null);
  const onSelectPartRef = useRef(onSelectPart);
  const autoSpinRef = useRef(autoSpin);
  const simPlayingRef = useRef(simPlaying);
  const simSpeedRef = useRef(simSpeed);
  const reduceMotionRef = useRef(reduceMotion);
  const plantFlowsRef = useRef<TwinMaterialFlow[]>(plantFlows);
  const modeRef = useRef<SceneModeId>(mode);
  const cameraGoalRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; active: boolean }>({
    pos: new THREE.Vector3(3.9, 2.75, 4.1),
    target: new THREE.Vector3(0, 0.65, 0),
    active: false,
  });

  const sceneBundleRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    built: BuiltSceneRoot | null;
    linksGroup: THREE.Group;
    linkDisposables: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }>;
    contactPlane: THREE.Mesh;
    floorRing: THREE.Mesh;
    isSoftwareGl: boolean;
    requestRender: () => void;
    applyHighlight: () => void;
    rebuildRelationshipArcs: () => void;
    focusOnTarget: (targetId: string) => void;
  } | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    explodeTargetRef.current = explodeAmount;
    sceneBundleRef.current?.requestRender();
  }, [explodeAmount]);

  useEffect(() => {
    selectedPartIdRef.current = selectedPartId || null;
    sceneBundleRef.current?.applyHighlight();
    sceneBundleRef.current?.rebuildRelationshipArcs();
    sceneBundleRef.current?.requestRender();
  }, [selectedPartId]);

  useEffect(() => {
    plantFlowsRef.current = plantFlows;
    sceneBundleRef.current?.rebuildRelationshipArcs();
    sceneBundleRef.current?.requestRender();
  }, [plantFlows]);

  useEffect(() => {
    onSelectPartRef.current = onSelectPart;
  }, [onSelectPart]);

  useEffect(() => {
    autoSpinRef.current = autoSpin;
    const b = sceneBundleRef.current;
    if (b) {
      b.controls.autoRotate = !b.isSoftwareGl && !reduceMotionRef.current && autoSpin;
      b.requestRender();
    }
  }, [autoSpin]);

  useEffect(() => {
    simPlayingRef.current = simPlaying;
    sceneBundleRef.current?.requestRender();
  }, [simPlaying]);

  useEffect(() => {
    simSpeedRef.current = simSpeed;
    sceneBundleRef.current?.requestRender();
  }, [simSpeed]);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    const b = sceneBundleRef.current;
    if (b) {
      b.controls.autoRotate = !b.isSoftwareGl && !reduceMotion && autoSpinRef.current;
      b.requestRender();
    }
  }, [reduceMotion]);

  useEffect(() => {
    if (focusTargetId && sceneBundleRef.current) {
      sceneBundleRef.current.focusOnTarget(focusTargetId);
    }
  }, [focusTargetId]);

  useEffect(() => {
    if (effectiveRenderMode === '3d') {
      sceneBundleRef.current?.requestRender();
    }
  }, [effectiveRenderMode]);

  const activePresets = useMemo(
    () => (mode === 'plant' ? PLANT_CAMERA_PRESETS : ASSEMBLY_CAMERA_PRESETS),
    [mode]
  );

  const applyCameraPreset = (presetId: CameraPresetId) => {
    setCameraPreset(presetId);
    const p = activePresets[presetId] || activePresets.iso;
    cameraGoalRef.current = {
      pos: new THREE.Vector3(...p.position),
      target: new THREE.Vector3(...p.target),
      active: true,
    };
    const b = sceneBundleRef.current;
    if (b && (b.isSoftwareGl || reduceMotionRef.current)) {
      b.camera.position.copy(cameraGoalRef.current.pos);
      b.controls.target.copy(cameraGoalRef.current.target);
      cameraGoalRef.current.active = false;
      b.controls.update();
    }
    b?.requestRender();
  };

  // Core Three.js Initialization (mounted once cleanly)
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const probe = detectSoftwareWebGL();
    if (!probe.supported) {
      setContextError('WebGL unavailable — switched to interactive 2D Digital Twin fallback.');
      return;
    }

    const isSoftwareGl = probe.isSoftwareGl;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme === 'dark' ? '#0b1120' : '#f1f5f9');

    const w = Math.max(container.clientWidth, 320);
    const h = Math.max(container.clientHeight, 240);
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(3.9, 2.75, 4.1);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setContextError('WebGL context could not be created — using interactive 2D Digital Twin fallback.');
      return;
    }

    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    if (!isSoftwareGl) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // PMREM Studio Reflections (RoomEnvironment across desktop, mobile & software WebGL)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    roomEnv.dispose();
    pmrem.dispose();

    // 3-Point Industrial Studio Lighting
    const hemi = new THREE.HemisphereLight('#e0f2fe', '#334155', 0.58);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff7ed', 1.85);
    keyLight.position.set(5.5, 8.5, 5.0);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 25;
      keyLight.shadow.camera.left = -7;
      keyLight.shadow.camera.right = 7;
      keyLight.shadow.camera.top = 7;
      keyLight.shadow.camera.bottom = -7;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#60a5fa', 0.72);
    rimLight.position.set(-5.5, 4.2, -4.8);
    scene.add(rimLight);

    // Contact Shadow Grounding Disc (Assembly Mode)
    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(5.2, 5.2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const contactPlane = new THREE.Mesh(shadowGeo, shadowMat);
    contactPlane.rotation.x = -Math.PI / 2;
    contactPlane.position.y = 0.002;
    scene.add(contactPlane);

    // Precision Polar Ring on Studio Floor (Assembly Mode)
    const ringGeo = new THREE.RingGeometry(1.72, 1.75, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: theme === 'dark' ? '#334155' : '#cbd5e1',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
    });
    const floorRing = new THREE.Mesh(ringGeo, ringMat);
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.003;
    scene.add(floorRing);

    // Dynamic BOM / Material Relationship Arcs Group
    const linksGroup = new THREE.Group();
    scene.add(linksGroup);
    const linkDisposables: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }> = [];

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.65, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 1.4;
    controls.maxDistance = 24;
    controls.autoRotate = !isSoftwareGl && !reduceMotionRef.current && autoSpinRef.current;
    controls.autoRotateSpeed = 0.75;
    controls.update();

    let disposed = false;
    let rafId = 0;
    let isOrbitDragging = false;
    let lastTime = performance.now();

    const savedEmissives = new Map<THREE.MeshStandardMaterial, { hex: number; intensity: number }>();

    const clearLinks = () => {
      while (linksGroup.children.length > 0) {
        linksGroup.remove(linksGroup.children[0]);
      }
      linkDisposables.forEach((d) => {
        d.geo.dispose();
        d.mat.dispose();
      });
      linkDisposables.length = 0;
    };

    const rebuildRelationshipArcs = () => {
      clearLinks();
      const bundle = sceneBundleRef.current;
      if (!bundle?.built?.floorAnchors || modeRef.current !== 'plant') return;

      const anchors = bundle.built.floorAnchors;
      const targetId = selectedPartIdRef.current;
      const flows = plantFlowsRef.current;
      if (!flows.length) return;

      const activeFlows = targetId
        ? flows.filter(
            (f) =>
              `sku-${f.componentSku}` === targetId ||
              `station-${f.targetStationNumber}` === targetId
          )
        : flows.slice(0, 4);

      activeFlows.forEach((flow) => {
        const src = anchors.get(`sku-${flow.componentSku}`) || anchors.get(flow.componentSku.toUpperCase());
        const dst =
          anchors.get(`station-${flow.targetStationNumber}`) ||
          anchors.get(flow.targetStationId.toUpperCase());
        if (!src || !dst) return;

        const p0 = new THREE.Vector3(src[0], src[1], src[2]);
        const p2 = new THREE.Vector3(dst[0], dst[1] + 0.55, dst[2]);
        const mid = p0.clone().lerp(p2, 0.5);
        mid.y = Math.max(p0.y, p2.y) + 0.85;

        const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
        const pts = curve.getPoints(16);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const colorHex = VISUAL_INDICATOR_SPECS[flow.visualStatus].hexColor;
        const lineMat = new THREE.LineBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: targetId ? 0.92 : 0.48,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        linksGroup.add(line);
        linkDisposables.push({ geo: lineGeo, mat: lineMat });
      });
    };

    const applyHighlight = () => {
      savedEmissives.forEach((orig, mat) => {
        mat.emissive.setHex(orig.hex);
        mat.emissiveIntensity = orig.intensity;
      });
      savedEmissives.clear();

      const bundle = sceneBundleRef.current;
      const targetId = selectedPartIdRef.current;
      if (!bundle?.built || !targetId) return;

      bundle.built.parts.forEach((partObj) => {
        const meta = partObj.userData as PartUserData;
        if (meta.partId !== targetId) return;
        partObj.traverse((child) => {
          const m = child as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              if (!savedEmissives.has(mat)) {
                savedEmissives.set(mat, {
                  hex: mat.emissive.getHex(),
                  intensity: mat.emissiveIntensity,
                });
              }
              mat.emissive.setHex(0x2563eb);
              mat.emissiveIntensity = 0.35;
            }
          });
        });
      });
    };

    const focusOnTarget = (targetId: string) => {
      const bundle = sceneBundleRef.current;
      if (!bundle?.built) return;
      const anchor = bundle.built.floorAnchors?.get(targetId);
      let targetVec: THREE.Vector3 | null = anchor ? new THREE.Vector3(...anchor) : null;

      if (!targetVec) {
        const found = bundle.built.parts.find((p) => (p.userData as PartUserData).partId === targetId);
        if (found) {
          const box = new THREE.Box3().setFromObject(found);
          if (!box.isEmpty()) {
            targetVec = box.getCenter(new THREE.Vector3());
          }
        }
      }
      if (!targetVec) return;

      const offset =
        modeRef.current === 'plant'
          ? new THREE.Vector3(2.8, 2.35, 3.35)
          : new THREE.Vector3(2.1, 1.45, 2.2);

      cameraGoalRef.current = {
        target: targetVec,
        pos: targetVec.clone().add(offset),
        active: true,
      };
      if (bundle.isSoftwareGl || reduceMotionRef.current) {
        camera.position.copy(cameraGoalRef.current.pos);
        controls.target.copy(cameraGoalRef.current.target);
        cameraGoalRef.current.active = false;
        controls.update();
      }
      bundle.requestRender();
    };

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext();
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          const poll = () => {
            if (disposed) {
              gl.deleteSync(sync);
              return;
            }
            const status = gl.clientWaitSync(sync, 0, 0);
            if (status === gl.TIMEOUT_EXPIRED) {
              requestAnimationFrame(poll);
            } else {
              gl.deleteSync(sync);
              cb();
            }
          };
          requestAnimationFrame(poll);
          return;
        }
      }
      requestAnimationFrame(cb);
    };

    const stepAndDraw = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const bundle = sceneBundleRef.current;
      let keepGoing = false;

      if (bundle?.built) {
        // 1. Damped Exploded BOM Animation
        const targetExp = explodeTargetRef.current;
        if (Math.abs(explodeCurrentRef.current - targetExp) > 0.001) {
          explodeCurrentRef.current =
            isSoftwareGl || reduceMotionRef.current
              ? targetExp
              : THREE.MathUtils.damp(explodeCurrentRef.current, targetExp, 7.5, dt);
          keepGoing = true;
        } else {
          explodeCurrentRef.current = targetExp;
        }

        const exp = explodeCurrentRef.current;
        bundle.built.parts.forEach((partObj) => {
          const meta = partObj.userData as PartUserData;
          if (!meta.basePos || !meta.explodeOffset) return;
          partObj.position.set(
            meta.basePos[0] + meta.explodeOffset[0] * exp,
            meta.basePos[1] + meta.explodeOffset[1] * exp,
            meta.basePos[2] + meta.explodeOffset[2] * exp
          );
        });

        // 2. Plant Simulation Playback (Conveyor Items + Material Carriers + Spindle Heads)
        const playing = simPlayingRef.current && !reduceMotionRef.current;
        const speedMult = simSpeedRef.current;

        if (playing) {
          if (bundle.built.conveyorItems.length > 0) {
            bundle.built.conveyorItems.forEach((item) => {
              if (item.speed <= 0) return;
              item.phase = (item.phase + dt * item.speed * speedMult) % 1;
              item.mesh.position.x = -4.2 + item.phase * 8.4;
            });
            keepGoing = true;
          }

          if (bundle.built.materialCarriers?.length) {
            bundle.built.materialCarriers.forEach((carrier) => {
              if (carrier.stalled || carrier.speed <= 0) return;
              carrier.phase = (carrier.phase + dt * carrier.speed * speedMult) % 1;
              carrier.mesh.position.lerpVectors(carrier.start, carrier.end, carrier.phase);
            });
            keepGoing = true;
          }

          if (bundle.built.animatedHeads?.length) {
            bundle.built.animatedHeads.forEach((head) => {
              if (!head.active) return;
              head.phase += dt * 4.5 * speedMult;
              head.mesh.position.y = head.baseY - Math.abs(Math.sin(head.phase)) * 0.14;
              head.mesh.rotation.y += dt * 2.8 * speedMult;
            });
            keepGoing = true;
          }
        }
      }

      // 3. Camera Preset / Focus Transition
      if (cameraGoalRef.current.active) {
        if (isSoftwareGl || reduceMotionRef.current) {
          camera.position.copy(cameraGoalRef.current.pos);
          controls.target.copy(cameraGoalRef.current.target);
          cameraGoalRef.current.active = false;
        } else {
          camera.position.lerp(cameraGoalRef.current.pos, Math.min(1, dt * 7));
          controls.target.lerp(cameraGoalRef.current.target, Math.min(1, dt * 7));
          if (
            camera.position.distanceTo(cameraGoalRef.current.pos) < 0.02 &&
            controls.target.distanceTo(cameraGoalRef.current.target) < 0.02
          ) {
            camera.position.copy(cameraGoalRef.current.pos);
            controls.target.copy(cameraGoalRef.current.target);
            cameraGoalRef.current.active = false;
          } else {
            keepGoing = true;
          }
        }
      }

      const moved = controls.update();
      if (moved || controls.autoRotate) {
        keepGoing = true;
      }

      renderer.render(scene, camera);

      if (keepGoing && !disposed) {
        if (isSoftwareGl) {
          afterDraw(() => {
            if (!disposed) requestRender();
          });
        } else {
          rafId = requestAnimationFrame(loop);
        }
      } else {
        rafId = 0;
      }
    };

    const loop = (now: number) => {
      rafId = 0;
      if (disposed) return;
      stepAndDraw(now);
    };

    const requestRender = () => {
      if (disposed) return;
      if (!rafId) {
        rafId = requestAnimationFrame(loop);
      }
    };

    const onControlStart = () => {
      isOrbitDragging = true;
      cameraGoalRef.current.active = false;
    };
    const onControlEnd = () => {
      isOrbitDragging = false;
    };
    controls.addEventListener('change', requestRender);
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('end', onControlEnd);

    // Raycast hover + click selection (skipped while dragging camera, deduplicated React state updates)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastMoveCheck = 0;

    const pickPartAt = (clientX: number, clientY: number): Selected3DPart | null => {
      const bundle = sceneBundleRef.current;
      if (!bundle?.built) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(bundle.built.parts, true);
      if (!hits.length) return null;
      const meta = hits[0].object.userData as PartUserData | undefined;
      if (!meta || !meta.partId) return null;
      return {
        partId: meta.partId,
        label: meta.label,
        sku: meta.sku,
        qtyPer: meta.qtyPer,
        role: meta.role,
        stationNumber: meta.stationNumber,
        rackCode: meta.rackCode,
        machineState: meta.machineState,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      cameraGoalRef.current.active = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (isOrbitDragging) return;
      const now = performance.now();
      if (now - lastMoveCheck < 50) return;
      lastMoveCheck = now;
      const hit = pickPartAt(e.clientX, e.clientY);
      const nextId = hit?.partId ?? null;
      if (hoveredPartIdRef.current !== nextId) {
        hoveredPartIdRef.current = nextId;
        setHoveredPart(hit);
        renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;
      const hit = pickPartAt(e.clientX, e.clientY);
      if (hit) {
        onSelectPartRef.current?.(hit);
      }
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextError('3D WebGL context paused — showing interactive 2D Digital Twin fallback.');
    };
    const onContextRestored = () => {
      setContextError(null);
      requestRender();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const width = Math.max(entry.contentRect.width, 280);
        const height = Math.max(entry.contentRect.height, 220);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    sceneBundleRef.current = {
      scene,
      camera,
      renderer,
      controls,
      built: null,
      linksGroup,
      linkDisposables,
      contactPlane,
      floorRing,
      isSoftwareGl,
      requestRender,
      applyHighlight,
      rebuildRelationshipArcs,
      focusOnTarget,
    };

    requestRender();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('end', onControlEnd);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      clearLinks();
      const b = sceneBundleRef.current;
      if (b?.built) {
        b.scene.remove(b.built.root);
        b.built.dispose();
      }
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      envRT.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneBundleRef.current = null;
      prevBuildMetaRef.current = null;
    };
    // Intentionally mounted once per viewport lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update background theme cleanly without recreating context
  useEffect(() => {
    const b = sceneBundleRef.current;
    if (!b) return;
    b.scene.background = new THREE.Color(theme === 'dark' ? '#0b1120' : '#f1f5f9');
    b.requestRender();
  }, [theme]);

  // Swap or incrementally update 3D model / plant floor geometry when mode, assemblySku, finish, or live twin state changes
  const prevModeRef = useRef<SceneModeId>(mode);
  const prevBuildMetaRef = useRef<{ mode: SceneModeId; finish: FinishPresetId } | null>(null);
  useEffect(() => {
    const b = sceneBundleRef.current;
    if (!b) return;

    if (
      mode === 'plant' &&
      b.built &&
      prevBuildMetaRef.current?.mode === 'plant' &&
      prevBuildMetaRef.current?.finish === finish &&
      updatePlantFloorTwin(b.built, plantProducts, plantStations)
    ) {
      b.applyHighlight();
      b.rebuildRelationshipArcs();
      b.requestRender();
      return;
    }

    if (b.built) {
      b.scene.remove(b.built.root);
      b.built.dispose();
      b.built = null;
    }

    const built =
      mode === 'plant'
        ? buildPlantFloorTwin(plantProducts, plantStations, finish)
        : buildAssembly3D(assemblySku, finish);

    b.built = built;
    prevBuildMetaRef.current = { mode, finish };
    b.scene.add(built.root);
    b.contactPlane.visible = mode === 'assembly';
    b.floorRing.visible = mode === 'assembly';

    // Only reset camera when switching mode (preserve user camera when scrubbing simulation frames or comparing scenarios)
    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      const preset = (mode === 'plant' ? PLANT_CAMERA_PRESETS : ASSEMBLY_CAMERA_PRESETS).iso;
      setCameraPreset('iso');
      b.camera.position.set(...preset.position);
      b.controls.target.set(...preset.target);
      cameraGoalRef.current.active = false;
      b.controls.update();
    }
    b.applyHighlight();
    b.rebuildRelationshipArcs();
    b.requestRender();
  }, [mode, assemblySku, finish, plantProducts, plantStations]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#0b1120] ${
        compact
          ? 'h-[240px] sm:h-[300px]'
          : 'h-[300px] sm:h-[420px] lg:h-[560px] max-h-[75vh] min-h-[240px]'
      } ${className}`}
    >
      {/* Isolated WebGL Mount Container */}
      <div
        ref={mountRef}
        data-testid="factory-3d-canvas-host"
        className={`w-full h-full select-none ${effectiveRenderMode === '2d' ? 'hidden' : 'block'}`}
      />

      {/* Functional 2D Digital Twin Fallback (auto-active if WebGL unavailable, or toggleable) */}
      {effectiveRenderMode === '2d' && (
        <DigitalTwin2DFallback
          mode={mode}
          assemblySku={assemblySku}
          explodeAmount={explodeAmount}
          plantProducts={plantProducts}
          plantStations={plantStations}
          selectedPartId={selectedPartId}
          onSelectPart={(p) => onSelectPart?.(p)}
          simPlaying={simPlaying}
          reason={contextError}
          theme={theme}
        />
      )}

      {/* Top-left crisp telemetry HUD (no backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
        <div className="rounded-lg border border-slate-300/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 px-3 py-2 shadow-sm max-w-md">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <Layers className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            <span className="truncate">
              {mode === 'plant'
                ? 'DES-Connected Plant & Warehouse Twin'
                : `3D Assembly · ${assemblySku}`}
            </span>
          </div>
          {hoveredPart ? (
            <div className="mt-1 text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {hoveredPart.label} ·{' '}
              <span className="font-mono text-[var(--accent)]">
                {hoveredPart.rackCode || hoveredPart.sku}
              </span>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              {effectiveRenderMode === '2d'
                ? '2D Schematic Fallback · Click any workstation or rack bin'
                : 'Drag to orbit · Scroll to zoom · Click any rack or machine'}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Bottom Control Dock (Zero backdrop-blur over WebGL) */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-col items-center pointer-events-none">
        {dockCollapsed ? (
          <button
            type="button"
            onClick={() => setDockCollapsed(false)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-md hover:border-[var(--accent)] cursor-pointer"
          >
            <ChevronUp className="h-3.5 w-3.5" /> Show Twin Controls
          </button>
        ) : (
          <div className="pointer-events-auto w-full max-w-4xl rounded-xl border border-slate-300/80 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 px-2.5 sm:px-3 py-2 shadow-lg overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Explode BOM Slider (Assembly Mode) */}
              {mode === 'assembly' && onExplodeChange && (
                <label className="flex items-center gap-2 min-w-[165px] flex-1 max-w-[225px]">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    Explode BOM
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={explodeAmount}
                    aria-label="Explode BOM assembly"
                    onChange={(e) => onExplodeChange(Number(e.target.value))}
                    className="w-full accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 w-9 text-right">
                    {Math.round(explodeAmount * 100)}%
                  </span>
                </label>
              )}

              {/* Simulation Playback Controls (Plant Mode) */}
              {mode === 'plant' && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="twin-play-pause-btn"
                    onClick={() => setSimPlaying(!simPlaying)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      simPlaying
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {simPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    <span>{simPlaying ? 'Pause Sim' : 'Play Sim'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={cycleSimSpeed}
                    title="Cycle simulation playback speed"
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {simSpeed}×
                  </button>
                </div>
              )}

              {/* Camera Presets (hidden in 2D fallback) */}
              {effectiveRenderMode === '3d' && (
                <div className="flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5 text-slate-400 mr-0.5 hidden sm:inline" />
                  {(['iso', 'front', 'top', 'detail'] as CameraPresetId[]).map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => applyCameraPreset(cid)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        cameraPreset === cid
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {activePresets[cid].label}
                    </button>
                  ))}
                  {selectedPartId && (
                    <button
                      type="button"
                      onClick={() => sceneBundleRef.current?.focusOnTarget(selectedPartId)}
                      title="Focus camera on selected machine or rack"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[11px] font-medium text-[var(--accent)] cursor-pointer"
                    >
                      <Crosshair className="h-3 w-3" />
                      <span className="hidden md:inline">Focus</span>
                    </button>
                  )}
                </div>
              )}

              {/* Finish Presets (3D only) */}
              {onFinishChange && effectiveRenderMode === '3d' && (
                <div className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5 text-slate-400 mr-0.5 hidden sm:inline" />
                  {(Object.keys(FINISH_PRESETS) as FinishPresetId[]).map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      title={FINISH_PRESETS[fid].label}
                      onClick={() => onFinishChange(fid)}
                      className={`px-2 py-1 rounded text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                        finish === fid
                          ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {fid}
                    </button>
                  ))}
                </div>
              )}

              {/* Render Mode (3D / 2D), Orbit & Dock Collapse */}
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  data-testid="toggle-2d-fallback-btn"
                  onClick={toggleRenderMode}
                  disabled={Boolean(contextError)}
                  title={
                    effectiveRenderMode === '3d'
                      ? 'Switch to 2D Schematic Fallback view'
                      : 'Switch back to 3D WebGL view'
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-mono transition-colors cursor-pointer ${
                    effectiveRenderMode === '2d'
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Grid2x2 className="h-3 w-3" />
                  <span>{effectiveRenderMode === '2d' ? '2D Map' : '3D'}</span>
                </button>

                {effectiveRenderMode === '3d' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setAutoSpin((s) => !s)}
                      title={autoSpin ? 'Pause auto-orbit' : 'Enable auto-orbit'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {autoSpin ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      <span className="hidden sm:inline">{autoSpin ? 'Orbit' : 'Static'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onExplodeChange?.(0);
                        applyCameraPreset('iso');
                      }}
                      title="Reset camera view"
                      aria-label="Reset camera view"
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setDockCollapsed(true)}
                  title="Hide 3D controls"
                  aria-label="Hide 3D controls"
                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
