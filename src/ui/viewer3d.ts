import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { easeInOutCubic, sphericalFor, viewDirForZone, zoneForLocalPoint, type FaceName } from '../lib/viewCubeMath'
import type { Mesh } from '../lib/types'

/** Size of the ViewCube corner viewport in CSS pixels. */
const CUBE_VIEW_PX = 96
/** Inset of the cube viewport from the canvas corner (matches .cube-overlay). */
const CUBE_MARGIN_PX = 8

/** BoxGeometry group order → FaceName. */
const MATERIAL_FACE: FaceName[] = ['right', 'left', 'top', 'bottom', 'front', 'back']

/** Print-coordinate axis directions in scene space (Y up, depth = −Z). */
const AXIS_DEFS = [
  { dir: new THREE.Vector3(1, 0, 0), color: 0xe5484d, label: 'X' },
  { dir: new THREE.Vector3(0, 0, -1), color: 0x46a758, label: 'Y' },
  { dir: new THREE.Vector3(0, 1, 0), color: 0x3b82f6, label: 'Z' },
]

/** Dispose geometries, materials and sprite textures under `root`. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    const o = obj as THREE.Mesh
    o.geometry?.dispose()
    const m = o.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
    else if (m) {
      ;(m as THREE.SpriteMaterial).map?.dispose()
      m.dispose()
    }
  })
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Linear blend between two hex colors. */
function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const c = (v1: number, v2: number) => Math.round(v1 + (v2 - v1) * t)
  return `#${((1 << 24) | (c(r1, r2) << 16) | (c(g1, g2) << 8) | c(b1, b2)).toString(16).slice(1)}`
}

/** Canvas texture with a centered bold label. */
function labelTexture(text: string, color: string, px = 96, font = 900): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = `${font} ${Math.round(px * 0.34)}px 'Segoe UI', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, px / 2, px / 2 + px * 0.02)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

interface Flight {
  t0: number
  dur: number
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
}

/**
 * 3D preview: renders the colored mesh with orbit controls, a grid floor,
 * colored print axes, and a Fusion-360-style ViewCube in the top-right
 * corner (click faces/edges/corners to jump to that view; home button
 * restores the fitted view). Runs a continuous render loop (required for
 * smooth damping).
 */
export class Viewer3D {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private meshGroup: THREE.Group
  private container: HTMLElement
  private rafHandle = 0
  private hasMesh = false
  private bedGroup: THREE.Group | null = null
  private axesGroup: THREE.Group | null = null
  private bedDims: { w: number; h: number } | null = null

  // ---- ViewCube (separate mini-scene drawn in a corner viewport) ----
  private cubeScene = new THREE.Scene()
  private cubeCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 20)
  private cube: THREE.Mesh | null = null
  private cubeEdges: THREE.LineSegments | null = null
  private cubeTriad = new THREE.Group()
  private cubeFaceMaterials: THREE.MeshBasicMaterial[] = []
  private faceLabels: Record<FaceName, string> = {
    top: 'TOP', bottom: 'BOTTOM', front: 'FRONT', back: 'BACK', right: 'RIGHT', left: 'LEFT',
  }
  private hoveredFaces: FaceName[] = []
  private downAt: { x: number; y: number } | null = null

  // ---- theme-derived colors for the cube ----
  private cubeFill = '#26303b'
  private cubeText = '#e8eef4'
  private cubeEdge = '#4a5a6a'

  // ---- camera flight ----
  private flight: Flight | null = null
  private homePos = new THREE.Vector3(220, 180, 260)
  private homeTarget = new THREE.Vector3(0, 0, 0)

  constructor(container: HTMLElement, cubeOverlay?: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#101418')

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 5000)
    this.camera.position.set(220, 180, 260)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true

    // Lighting — mostly ambient for accurate flat colors.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.95))
    const dir = new THREE.DirectionalLight(0xffffff, 0.35)
    dir.position.set(100, 200, 100)
    this.scene.add(dir)

    this.meshGroup = new THREE.Group()
    // Bed and axes are built per-mesh in setMesh, sized to the print.
    this.meshGroup.rotation.x = -Math.PI / 2
    this.scene.add(this.meshGroup)

    this.buildCube()
    this.cubeCamera.position.set(0, 0, 3.4)
    this.cubeCamera.lookAt(0, 0, 0)

    if (cubeOverlay) this.bindCubeOverlay(cubeOverlay)

    // A user grab on the main canvas cancels any in-flight camera animation.
    this.renderer.domElement.addEventListener('pointerdown', () => this.cancelFlight())

    new ResizeObserver(() => this.resize()).observe(container)

    const loop = () => {
      this.rafHandle = requestAnimationFrame(loop)
      this.stepFlight()
      if (!this.flight) this.controls.update()
      this.syncCube()
      this.renderFrame()
    }
    loop()
  }

  // =====================================================================
  // Main scene
  // =====================================================================

  /** Replace the displayed mesh; re-frames the camera on the first mesh. */
  setMesh(mesh: Mesh, footprint?: { wMm: number; hMm: number }) {
    this.clearMesh()

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
    this.meshGroup.add(new THREE.Mesh(geometry, material))

    // Rebuild the bed grid and axes to match the print footprint exactly.
    const w = footprint?.wMm ?? 150
    const h = footprint?.hMm ?? 150
    if (!this.bedDims || this.bedDims.w !== w || this.bedDims.h !== h) {
      this.rebuildBed(w, h)
    }

    if (!this.hasMesh) {
      this.hasMesh = true
      this.fitCamera()
    }
  }

  /**
   * Build the bed grid sized to the print and the axes at the print's
   * origin corner, so the model always sits exactly on the bed (slicers
   * place the model at X0 Y0; the old fixed 400 mm grid hung the print
   * over the edge for any footprint other than ~200×200).
   *
   * Print coordinates map to scene space as: X → +X, Y (depth) → −Z,
   * Z (up) → +Y (meshGroup carries the −90° X rotation). The grid is
   * built from unit lines instead of GridHelper so non-square footprints
   * fit exactly.
   */
  private rebuildBed(wMm: number, hMm: number) {
    if (this.bedGroup) {
      this.scene.remove(this.bedGroup)
      disposeTree(this.bedGroup)
    }
    if (this.axesGroup) {
      this.scene.remove(this.axesGroup)
      disposeTree(this.axesGroup)
    }
    this.bedDims = { w: wMm, h: hMm }

    this.bedGroup = new THREE.Group()
    // Margin so the grid stays visible around the print (a bed exactly the
    // print's size hides under the model).
    const margin = Math.min(60, Math.max(20, 0.2 * Math.max(wMm, hMm)))
    this.bedGroup.add(this.buildBedGrid(wMm, hMm, margin))
    this.scene.add(this.bedGroup)

    // Axes at the print origin corner, scaled to the print size.
    this.axesGroup = this.buildAxes(Math.max(wMm, hMm) * 0.5, Math.max(wMm, hMm) * 0.06)
    this.scene.add(this.axesGroup)
  }

  /**
   * Rectangular bed grid around the print footprint [0,w]×[0,h] (print
   * coords → scene X [0,w], Z [−h,0]), extended by `margin` on all sides.
   * Minor lines every 10 mm, major every 50 mm.
   */
  private buildBedGrid(wMm: number, hMm: number, margin: number): THREE.Group {
    const x0 = -margin
    const x1 = wMm + margin
    const z0 = -hMm - margin
    const z1 = margin
    const minor: number[] = []
    const major: number[] = []
    const push = (arr: number[], x1: number, z1: number, x2: number, z2: number) => {
      arr.push(x1, 0, z1, x2, 0, z2)
    }
    for (let x = Math.ceil(x0 / 10) * 10; x <= x1 + 1e-6; x += 10) {
      const arr = Math.round(x) % 50 === 0 ? major : minor
      push(arr, x, z0, x, z1)
    }
    for (let z = Math.ceil(z0 / 10) * 10; z <= z1 + 1e-6; z += 10) {
      const arr = Math.round(z) % 50 === 0 ? major : minor
      push(arr, x0, z, x1, z)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(minor, 3))
    const minorLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x212a33 }))
    const geo2 = new THREE.BufferGeometry()
    geo2.setAttribute('position', new THREE.Float32BufferAttribute(major, 3))
    const majorLines = new THREE.LineSegments(geo2, new THREE.LineBasicMaterial({ color: 0x2c3843 }))
    const group = new THREE.Group()
    group.add(minorLines, majorLines)
    group.position.y = -0.02
    return group
  }

  /** Update the scene background (used when the UI theme changes). */
  setBackground(color: string) {
    this.scene.background = new THREE.Color(color)
    this.applyCubeTheme(color)
  }

  /** Localized face labels for the ViewCube; redraws the face textures. */
  setFaceLabels(labels: Record<FaceName, string>) {
    this.faceLabels = { ...labels }
    this.redrawCubeFaces()
  }

  /** Fly the camera back to the fitted home view. */
  goHome() {
    this.flyTo(this.homePos.clone(), this.homeTarget.clone())
  }

  private fitCamera() {
    const box = new THREE.Box3().setFromObject(this.meshGroup)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = (maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) * 1.5
    this.controls.target.copy(center)
    this.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.75, center.z + dist * 0.6)
    this.controls.update()
    this.homePos.copy(this.camera.position)
    this.homeTarget.copy(this.controls.target)
  }

  // =====================================================================
  // Axes
  // =====================================================================

  /** Colored arrows + letter sprites along the print axes. */
  private buildAxes(length: number, spriteScale: number): THREE.Group {
    const group = new THREE.Group()
    for (const a of AXIS_DEFS) {
      const arrow = new THREE.ArrowHelper(a.dir, new THREE.Vector3(0, 0.02, 0), length, a.color, length * 0.06, length * 0.03)
      group.add(arrow)
      const sprite = this.makeTextSprite(a.label, `#${a.color.toString(16).padStart(6, '0')}`, spriteScale)
      sprite.position.copy(a.dir).multiplyScalar(length * 1.09).add(new THREE.Vector3(0, 0.02, 0))
      group.add(sprite)
    }
    return group
  }

  private makeTextSprite(text: string, color: string, scale: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({ map: labelTexture(text, color, 64, 700), depthTest: false, transparent: true })
    const sprite = new THREE.Sprite(material)
    sprite.scale.setScalar(scale)
    return sprite
  }

  // =====================================================================
  // ViewCube
  // =====================================================================

  private buildCube() {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < 6; i++) {
      this.cubeFaceMaterials.push(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    }
    this.cube = new THREE.Mesh(geo, this.cubeFaceMaterials)
    this.cube.position.set(0.18, 0.3, 0)
    this.cubeScene.add(this.cube)

    this.cubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x4a5a6a }),
    )
    this.cubeEdges.position.copy(this.cube.position)
    this.cubeScene.add(this.cubeEdges)

    // Mini axis triad (print coordinates) in the viewport's bottom-left.
    for (const a of AXIS_DEFS) {
      this.cubeTriad.add(new THREE.ArrowHelper(a.dir, new THREE.Vector3(), 0.3, a.color, 0.07, 0.035))
      const sprite = this.makeTextSprite(a.label, `#${a.color.toString(16).padStart(6, '0')}`, 0.14)
      sprite.position.copy(a.dir).multiplyScalar(0.42)
      this.cubeTriad.add(sprite)
    }
    this.cubeTriad.position.set(-0.78, -0.82, 0)
    this.cubeScene.add(this.cubeTriad)
  }

  /** Redraw the six face textures (labels + theme fill + hover tint). */
  private redrawCubeFaces() {
    if (!this.cube) return
    for (const mat of this.cubeFaceMaterials) {
      mat.map?.dispose()
      mat.map = null
      mat.needsUpdate = true
    }
    MATERIAL_FACE.forEach((face, i) => {
      const hovered = this.hoveredFaces.includes(face)
      const fill = hovered ? mixHex(this.cubeFill, '#4fb8ff', 0.45) : this.cubeFill
      const mat = this.cubeFaceMaterials[i]
      mat.map = labelTexture(this.faceLabels[face], this.cubeText, 128, 800)
      mat.color = new THREE.Color(fill)
      mat.needsUpdate = true
    })
    if (this.cubeEdges) {
      this.cubeEdges.material = new THREE.LineBasicMaterial({ color: this.cubeEdge })
    }
  }

  /** Derive cube colors from the viewer background (theme change). */
  private applyCubeTheme(bg: string) {
    const dark = luminance(bg) < 0.5
    this.cubeFill = dark ? mixHex(bg, '#ffffff', 0.14) : mixHex(bg, '#000000', 0.1)
    this.cubeText = dark ? '#e8eef4' : '#1d2733'
    this.cubeEdge = dark ? mixHex(bg, '#ffffff', 0.35) : mixHex(bg, '#000000', 0.4)
    this.redrawCubeFaces()
  }

  /** Cube quaternion follows the main camera so faces show world orientation. */
  private syncCube() {
    const q = this.camera.quaternion.clone().invert()
    this.cube?.quaternion.copy(q)
    this.cubeEdges?.quaternion.copy(q)
    this.cubeTriad.quaternion.copy(q)
  }

  /** Draw the main view, then the cube into the top-right corner viewport. */
  private renderFrame() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return

    this.renderer.setViewport(0, 0, w, h)
    this.renderer.setScissorTest(false)
    this.renderer.render(this.scene, this.camera)

    this.renderer.setScissorTest(true)
    const cx = w - CUBE_VIEW_PX - CUBE_MARGIN_PX
    const cy = h - CUBE_VIEW_PX - CUBE_MARGIN_PX
    this.renderer.setScissor(cx, cy, CUBE_VIEW_PX, CUBE_VIEW_PX)
    this.renderer.setViewport(cx, cy, CUBE_VIEW_PX, CUBE_VIEW_PX)
    this.renderer.clearDepth()
    this.renderer.render(this.cubeScene, this.cubeCamera)
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, w, h)
  }

  /** Pointer picking over the corner overlay (hover + click). */
  private bindCubeOverlay(overlay: HTMLElement) {
    const raycast = (clientX: number, clientY: number): FaceName[] | null => {
      const rect = this.container.getBoundingClientRect()
      const w = rect.width
      const lx = clientX - rect.left - (w - CUBE_VIEW_PX - CUBE_MARGIN_PX)
      const ly = clientY - rect.top - CUBE_MARGIN_PX
      if (lx < 0 || ly < 0 || lx > CUBE_VIEW_PX || ly > CUBE_VIEW_PX) return null
      const ndc = new THREE.Vector2((lx / CUBE_VIEW_PX) * 2 - 1, -(ly / CUBE_VIEW_PX) * 2 + 1)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, this.cubeCamera)
      if (!this.cube) return null
      const hit = ray.intersectObject(this.cube)[0]
      if (!hit) return null
      const local = this.cube.worldToLocal(hit.point.clone())
      return zoneForLocalPoint(local.x, local.y, local.z, 0.5).faces
    }

    overlay.addEventListener('pointermove', (e) => {
      const faces = raycast(e.clientX, e.clientY)
      const changed = JSON.stringify(faces ?? []) !== JSON.stringify(this.hoveredFaces)
      if (changed) {
        this.hoveredFaces = faces ?? []
        this.redrawCubeFaces()
        overlay.style.cursor = faces ? 'pointer' : 'default'
      }
    })

    overlay.addEventListener('pointerleave', () => {
      if (this.hoveredFaces.length) {
        this.hoveredFaces = []
        this.redrawCubeFaces()
      }
      overlay.style.cursor = 'default'
    })

    overlay.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY }
    })

    overlay.addEventListener('pointerup', (e) => {
      if (!this.downAt) return
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y)
      this.downAt = null
      if (moved > 5) return // a drag, not a click
      const faces = raycast(e.clientX, e.clientY)
      if (!faces || faces.length === 0) return
      this.flyToZone(faces)
    })
  }

  /** Fly the camera so it looks along the zone's view direction. */
  private flyToZone(faces: FaceName[]) {
    const dir = viewDirForZone(faces)
    const sph = sphericalFor(dir)

    const offset = this.camera.position.clone().sub(this.controls.target)
    const cur = new THREE.Spherical().setFromVector3(offset)
    // Shortest angular path for theta.
    let dTheta = sph.theta - cur.theta
    if (dTheta > Math.PI) dTheta -= Math.PI * 2
    if (dTheta < -Math.PI) dTheta += Math.PI * 2
    const toSph = new THREE.Spherical(cur.radius, sph.phi, cur.theta + dTheta)
    const toPos = new THREE.Vector3().setFromSpherical(toSph).add(this.controls.target)
    this.flyTo(toPos, this.controls.target.clone())
  }

  /** Start a smooth camera flight; user grabs cancel it. */
  private flyTo(toPos: THREE.Vector3, toTarget: THREE.Vector3) {
    this.flight = {
      t0: performance.now(),
      dur: 550,
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget,
    }
  }

  private cancelFlight() {
    if (this.flight) {
      this.flight = null
      this.controls.update()
    }
  }

  private stepFlight() {
    if (!this.flight) return
    const t = (performance.now() - this.flight.t0) / this.flight.dur
    const e = easeInOutCubic(t)
    this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, e)
    this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, e)
    this.camera.lookAt(this.controls.target)
    if (t >= 1) {
      this.flight = null
      this.controls.update()
    }
  }

  // =====================================================================
  // Lifecycle
  // =====================================================================

  private clearMesh() {
    for (const child of [...this.meshGroup.children]) {
      this.meshGroup.remove(child)
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      const mat = mesh.material as THREE.Material | undefined
      mat?.dispose()
    }
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  /** Test/debug probe: current camera position and orbit target. */
  getCameraState(): { pos: [number, number, number]; target: [number, number, number] } {
    const p = this.camera.position
    const t = this.controls.target
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }
  }

  dispose() {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle)
    this.clearMesh()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
