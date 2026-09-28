import * as T from 'three';

/** Authored metre-scale assets. Forward is local -Z; no network asset dependencies. */
export function vessel(color: string) {
  const root = new T.Group();
  const steel = new T.MeshStandardMaterial({ color: '#697981', roughness: .57, metalness: .55 });
  const deck = new T.MeshStandardMaterial({ color: '#313f46', roughness: .9, metalness: .2 });
  const dark = new T.MeshStandardMaterial({ color: '#111e27', roughness: .22, metalness: .75 });
  const accent = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .25 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = steel) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m;
  };
  const shape = new T.Shape();
  shape.moveTo(0, -62); shape.lineTo(8, -39); shape.lineTo(8.5, 40); shape.lineTo(6, 52); shape.lineTo(-6, 52); shape.lineTo(-8.5, 40); shape.lineTo(-8, -39); shape.closePath();
  const hull = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 1.1, bevelThickness: 1 }), steel);
  hull.rotation.x = Math.PI / 2; hull.position.y = 6; hull.castShadow = true; hull.receiveShadow = true; root.add(hull);
  box(12, .5, 66, 0, 6.3, 8, deck);
  box(11, 8, 22, 0, 10, -7); box(9, 4, 12, 0, 16, -11); box(9.4, 1.8, 5, 0, 16.2, -15, dark);
  box(6.8, 10, 8, 0, 12, 13); box(5.8, 1, 7, 0, 17.5, 13, dark);
  box(.8, 20, .8, 0, 25, 0); box(10, 2, 1, 0, 30, 0, dark); box(1, 1, 10, 0, 33, 0);
  box(.2, 8, .2, -4, 22, -8); box(.2, 9, .2, 4, 22, -8);
  box(5, 3, 5, 0, 8, -34); box(.65, .65, 9, 0, 9, -40, dark);
  for (let x = -1; x <= 1; x++) for (let z = 0; z < 4; z++) box(1.8, .3, 1.8, x * 2.1, 6.8, -26 + z * 2.1, dark);
  for (const x of [-6, 6]) {
    box(.12, 1, 78, x, 7, 5);
    for (let z = -30; z < 45; z += 4) box(.12, 1.8, .12, x, 7, z);
    box(.3, .3, 15, x * .8, 6.7, 35, accent);
    const lamp = new T.Mesh(new T.SphereGeometry(.3, 6, 4), accent); lamp.position.set(x, 18, -13); root.add(lamp);
  }
  const pad = new T.Mesh(new T.RingGeometry(4, 4.2, 32), accent); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 6.7, 36); root.add(pad);
  box(.25, .1, 5, -1.5, 6.8, 36, accent); box(.25, .1, 5, 1.5, 6.8, 36, accent); box(3, .1, .3, 0, 6.8, 36, accent);
  const wake = new T.Mesh(new T.PlaneGeometry(38, 170), new T.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } }, vertexShader: 'varying vec2 uvW; void main(){uvW=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 uvW; uniform float time; void main(){float x=abs(uvW.x-.5)*2.; float spread=.2+(1.-uvW.y)*.8;
      float edge=1.-smoothstep(0.,.18,abs(x-spread*.8)); float fade=uvW.y*(1.-uvW.y)*4.; float foam=.5+.5*sin(uvW.y*120.-time*4.+x*20.);
      gl_FragColor=vec4(.65,.85,.88,(edge*.4+max(0.,1.-x/spread)*.12)*fade*foam);}` }));
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, .1, 132); wake.userData.wake = true; root.add(wake);
  return root;
}
export function aircraft(color: string) {
  const root = new T.Group(), mat = new T.MeshStandardMaterial({ color, metalness: .5, roughness: .45 });
  const body = new T.Mesh(new T.ConeGeometry(1.5, 18, 12), mat); body.rotation.x = -Math.PI / 2; root.add(body);
  const wing = new T.Mesh(new T.BoxGeometry(15, .25, 4), mat); wing.position.z = 2; root.add(wing);
  const tail = new T.Mesh(new T.BoxGeometry(6, .2, 2), mat); tail.position.z = 7; root.add(tail);
  return root;
}
export function contactMarker(color: string) {
  const g = new T.Group();
  const m = new T.Mesh(new T.OctahedronGeometry(20), new T.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .8 }));
  m.position.y = 32; g.add(m);
  const ring = new T.Mesh(new T.RingGeometry(.97, 1, 48), new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity: .42, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 2; ring.userData.uncertainty = true; g.add(ring);
  return g;
}
export function disposeObject(root: T.Object3D) {
  const materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
  root.traverse(o => { const m = o as T.Mesh; if (m.geometry) geometries.add(m.geometry); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(a => materials.add(a)); });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
