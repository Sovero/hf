import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Mesh } from '../lib/types'

/**
 * 3D preview: renders the colored mesh with orbit controls and a grid floor.
 * Runs a continuous render loop (required for smooth damping).
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

  constructor(container: HTMLElement) {
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

    // Print-bed grid (Y-up after rotating the model group).
    const grid = new THREE.GridHelper(400, 40, 0x2c3843, 0x212a33)
    grid.position.y = -0.02
    this.scene.add(grid)

    this.meshGroup = new THREE.Group()
    this.meshGroup.rotation.x = -Math.PI / 2
    this.scene.add(this.meshGroup)

    new ResizeObserver(() => this.resize()).observe(container)

    const loop = () => {
      this.rafHandle = requestAnimationFrame(loop)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    loop()
  }

  /** Replace the displayed mesh; re-frames the camera on the first mesh. */
  setMesh(mesh: Mesh) {
    this.clearMesh()

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
    this.meshGroup.add(new THREE.Mesh(geometry, material))

    if (!this.hasMesh) {
      this.hasMesh = true
      this.fitCamera()
    }
  }

  /** Update the scene background (used when the UI theme changes). */
  setBackground(color: string) {
    this.scene.background = new THREE.Color(color)
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
  }

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

  dispose() {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle)
    this.clearMesh()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
