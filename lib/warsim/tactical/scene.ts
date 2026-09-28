import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { WarSimSession } from '../../warSimTypes';
import { toENU, type Geo, type Vec3 } from '../physics/coordinates';
import { aircraft, contactMarker, disposeObject, vessel } from './assets';
import { recordWarSimMetric } from '../diagnostics';

interface Body { id: string; position: Vec3; heading: number; kind: 'ship' | 'air' | 'contact' | 'round'; color: string; speed: number }
type Display = { from: Body; to: Body; mesh: T.Object3D };
export class TacticalScene {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(48, 1, 1, 60000);
  private controls: OrbitControls;
  private origin: Geo;
  private offset = new T.Vector3();
  private bodies = new Map<string, Display>();
  private effects: { mesh: T.Mesh; position: Vec3; time: number; launch: boolean }[] = [];
  private trails = new Map<string, { points: Vec3[]; line: T.Line }>();
  private seen = new Set<number>();
  private frame = 0;
  private resize: ResizeObserver;
  private updated = 0;
  private interval = 100;
  private time = 0;
  private previousTime = 0;
  private playing = false;
  private followId: string | null = null;
  private audio?: AudioContext;
  private sound = false;
  private water: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private lost = false;
  private sun: T.DirectionalLight;
  private lastFollow?: T.Vector3;
  private lastTrail = -1;
  private lastFrame = 0;
  private adaptive = true;
  private frameBudget = { count: 0, total: 0 };
  private onLost = (e: Event) => { e.preventDefault(); this.lost = true; this.onError('Graphics context lost. Reopen the tactical view to recover.'); };
  constructor(private host: HTMLElement, initial: WarSimSession, private onSelect: (id: string, contact: boolean) => void, private onError: (message: string) => void) {
    this.origin = initial.physical?.origin ?? [...(initial.entities[0]?.lngLat ?? [0, 0]), 0] as Geo;
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .8;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '3D tactical ocean'); this.renderer.domElement.dataset.testid = 'tactical-canvas';
    host.appendChild(this.renderer.domElement); this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    this.scene.background = new T.Color('#9aafba'); this.scene.fog = new T.FogExp2('#91a7b2', .000025);
    const sky = new Sky(); sky.scale.setScalar(100000); const u = sky.material.uniforms;
    u.turbidity.value = 3; u.rayleigh.value = 1.8; u.mieCoefficient.value = .003;
    u.sunPosition.value.set(.6, .15, -.6); this.scene.add(sky);
    this.scene.add(new T.HemisphereLight('#c3e3ff', '#304050', 2));
    this.sun = new T.DirectionalLight('#ffe0b1', 3.4); this.sun.position.set(600, 900, -800); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024); Object.assign(this.sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 1, far: 4000 }); this.sun.shadow.bias = -.0002;
    this.scene.add(this.sun, this.sun.target);
    this.water = new T.Mesh(new T.PlaneGeometry(100000, 100000), new T.ShaderMaterial({ uniforms: { time: { value: 0 }, shift: { value: new T.Vector2() } },
      vertexShader: `varying vec3 world; void main(){ vec4 p=modelMatrix*vec4(position,1.); world=p.xyz; gl_Position=projectionMatrix*viewMatrix*p; }`,
      fragmentShader: `varying vec3 world; uniform float time; uniform vec2 shift;
        void main(){vec2 p=world.xz+shift; float a=p.x*.087+p.y*.031+time*1.2; float b=p.y*.12-p.x*.046-time*.8; float q=p.x*.33+p.y*.21+time*2.;
        float fa=1.-smoothstep(.4,3.,fwidth(a)); float fb=1.-smoothstep(.4,3.,fwidth(b)); float fc=1.-smoothstep(.4,3.,fwidth(q));
        float w=sin(a)*fa*.6+sin(b)*fb*.35+sin(q)*fc*.12;
        vec3 n=normalize(vec3(cos(a)*fa*.07+cos(q)*fc*.035,1.,cos(b)*fb*.055)); vec3 v=normalize(cameraPosition-world);
        float fres=pow(1.-max(dot(n,v),0.),4.); float spec=pow(max(dot(reflect(normalize(vec3(-.6,-.15,.6)),n),v),0.),140.);
        vec3 c=mix(vec3(.017,.075,.10),vec3(.29,.43,.50),fres)+spec*vec3(1.7,1.1,.6);
        c+=pow(max(w*.5+.2,0.),8.)*.08; float fog=1.-exp(-length(cameraPosition-world)*.000028); c=mix(c,vec3(.36,.46,.52),fog);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -1; this.scene.add(this.water);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.controls.minDistance = 35; this.controls.maxDistance = 25000; this.controls.maxPolarAngle = Math.PI * .485;
    this.camera.position.set(165, 95, 205); this.controls.target.set(0, 8, 0);
    this.resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }); this.resize.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pick);
    initial.physical?.events.forEach(e => this.seen.add(e.id)); this.update(initial);
    this.focus(initial.entities[0]?.id ?? null); this.animate();
  }
  private down = [0, 0];
  private pointerDown = (e: PointerEvent) => { this.down = [e.clientX, e.clientY]; };
  private pick = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    for (const hit of ray.intersectObjects([...this.bodies.values()].map(b => b.mesh), true)) {
      let o: T.Object3D | null = hit.object; while (o && !o.userData.id) o = o.parent;
      if (o) { const b = this.bodies.get(o.userData.id)!; if (b.to.kind !== 'round') { this.onSelect(b.to.id, b.to.kind === 'contact'); this.focus(b.to.id); return; } }
    }
  };
  private point(p: Vec3) { return new T.Vector3(p[0], p[2], -p[1]).sub(this.offset); }
  update(s: WarSimSession) {
    const now = performance.now(); this.interval = Math.max(16, Math.min(1000, now - this.updated)); this.updated = now;
    this.previousTime = this.time; this.time = s.simTimeSec; this.playing = s.status === 'running';
    const records: Body[] = s.entities.filter(e => e.status !== 'destroyed').map(e => ({ id: e.id,
      position: s.physical?.actors.find(a => a.id === e.id)?.position ?? toENU([...e.lngLat, e.altitudeM], this.origin), heading: e.headingDeg,
      kind: e.altitudeM > 100 ? 'air' : 'ship', color: e.iso === s.playerIso ? s.playerColor : s.enemyColor, speed: e.speedKmh / 3.6 }));
    const contacts = s.activeFaction === 'player' ? s.fogOfWarContacts.playerContacts : s.fogOfWarContacts.enemyContacts;
    records.push(...contacts.map(c => ({ id: c.contactId, position: toENU([...c.lastKnownLngLat, 0], this.origin), heading: c.headingDeg,
      kind: 'contact' as const, color: '#ff8f74', speed: c.speedKmh / 3.6 })));
    if (s.physical) records.push(...s.physical.rounds.map(r => ({ id: r.id, position: r.position, heading: Math.atan2(r.velocity[0], r.velocity[1]) * 180 / Math.PI,
      kind: 'round' as const, color: r.interceptor ? '#b3efff' : '#ffc478', speed: 0 })));
    else records.push(...s.activeMissiles.map(r => ({ id: r.id, position: toENU([...r.currentLngLat, r.threatAltitudeM ?? 100], this.origin), heading: 0, kind: 'round' as const, color: '#ffc478', speed: 0 })));
    const ids = new Set(records.map(r => r.id));
    for (const [id, b] of this.bodies) if (!ids.has(id)) { this.scene.remove(b.mesh); disposeObject(b.mesh); this.bodies.delete(id); const trail = this.trails.get(id); if (trail) { this.scene.remove(trail.line); disposeObject(trail.line); this.trails.delete(id); } }
    for (const r of records) {
      const b = this.bodies.get(r.id);
      if (b) { b.from = b.to; b.to = r; }
      else {
        const mesh = r.kind === 'ship' ? vessel(r.color) : r.kind === 'air' ? aircraft(r.color) : r.kind === 'contact' ? contactMarker(r.color)
          : new T.Mesh(new T.SphereGeometry(2.2, 8, 6), new T.MeshBasicMaterial({ color: r.color }));
        mesh.userData.id = r.id; this.scene.add(mesh); this.bodies.set(r.id, { from: r, to: r, mesh });
      }
    }
    for (const e of s.physical?.events ?? []) {
      if (this.seen.has(e.id)) continue; this.seen.add(e.id);
      if (e.kind === 'expired') continue;
      const launch = e.kind === 'launch';
      const mesh = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: launch ? '#fff0b0' : '#ff9a42', transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      this.scene.add(mesh); this.effects.push({ mesh, position: e.position, time: e.time, launch });
      this.cue(e.position, launch);
    }
    // The persistent event sequence handles once-only delivery; bounded set survives journal trimming.
    if (this.seen.size > 1024) this.seen = new Set((s.physical?.events ?? []).map(e => e.id));
  }
  focus(id: string | null) {
    this.followId = id; this.lastFollow = undefined;
    const b = id ? this.bodies.get(id) : undefined;
    if (b) { const p = this.point(b.to.position); this.controls.target.copy(p).add(new T.Vector3(0, 10, 0)); this.camera.position.copy(p).add(new T.Vector3(165, 95, 205)); }
  }
  overview() { this.followId = null; this.lastFollow = undefined; const center = new T.Vector3(); this.bodies.forEach(b => center.add(this.point(b.to.position))); center.divideScalar(this.bodies.size || 1); this.controls.target.copy(center); this.camera.position.copy(center).add(new T.Vector3(2200, 3000, 3800)); }
  quality(high: boolean) { this.adaptive = !high; this.frameBudget = { count: 0, total: 0 }; this.renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1)); this.renderer.shadowMap.enabled = high; this.renderer.setSize(this.host.clientWidth, this.host.clientHeight); }
  async audioEnabled(enabled: boolean) { this.sound = enabled; if (enabled) { this.audio ??= new AudioContext(); await this.audio.resume(); } else await this.audio?.suspend(); }
  private cue(position: Vec3, launch: boolean) {
    if (!this.sound || !this.audio || this.audio.state !== 'running') return;
    const a = this.audio, oscillator = a.createOscillator(), gain = a.createGain(), pan = a.createStereoPanner();
    const delta = this.point(position).sub(this.camera.position); pan.pan.value = Math.max(-1, Math.min(1, delta.x / 2500));
    gain.gain.setValueAtTime(.12 / (1 + delta.length() / 1000), a.currentTime); gain.gain.exponentialRampToValueAtTime(.001, a.currentTime + .7);
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(launch ? 160 : 65, a.currentTime); oscillator.frequency.exponentialRampToValueAtTime(25, a.currentTime + .7);
    oscillator.connect(gain).connect(pan).connect(a.destination); oscillator.start(); oscillator.stop(a.currentTime + .75);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); pan.disconnect(); };
  }
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate); if (this.lost || document.hidden) { this.lastFrame = 0; return; }
    const frameStart = performance.now();
    if (this.lastFrame) {
      const interval = frameStart - this.lastFrame; recordWarSimMetric('tactical.frame.interval.ms', interval);
      if (this.adaptive && interval < 500) {
        this.frameBudget.total += interval; this.frameBudget.count++;
        if (this.frameBudget.count >= 30) {
          if (this.frameBudget.total / this.frameBudget.count > 38 && this.renderer.getPixelRatio() > .5) {
            this.renderer.setPixelRatio(Math.max(.5, this.renderer.getPixelRatio() * .8));
          }
          this.frameBudget = { count: 0, total: 0 };
        }
      }
    }
    recordWarSimMetric('tactical.pixelRatio', this.renderer.getPixelRatio());
    this.lastFrame = frameStart;
    const alpha = this.playing ? Math.min(1, (performance.now() - this.updated) / this.interval) : 1;
    const time = T.MathUtils.lerp(this.previousTime, this.time, alpha);
    for (const b of this.bodies.values()) {
      const p = b.from.position.map((n, i) => T.MathUtils.lerp(n, b.to.position[i], alpha)) as Vec3;
      b.mesh.position.copy(this.point(p)); const delta = ((b.to.heading - b.from.heading + 540) % 360) - 180;
      b.mesh.rotation.y = -(b.from.heading + delta * alpha) * Math.PI / 180;
      if (b.to.kind === 'ship') { b.mesh.rotation.z = Math.sin(time * .6) * .008; b.mesh.rotation.x = Math.sin(time * .9) * .003;
        const wake = b.mesh.children.find(c => c.userData.wake) as T.Mesh<T.PlaneGeometry, T.ShaderMaterial> | undefined;
        if (wake) { wake.visible = b.to.speed > 1; wake.material.uniforms.time.value = time; }
      }
      if (b.to.id === this.followId) { if (this.lastFollow) { const d = b.mesh.position.clone().sub(this.lastFollow); this.controls.target.add(d); this.camera.position.add(d); } this.lastFollow = b.mesh.position.clone(); }
      if (b.to.kind === 'round' && time - this.lastTrail > .04) {
        let trail = this.trails.get(b.to.id);
        if (!trail) { const line = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: b.to.color, transparent: true, opacity: .6 })); this.scene.add(line); trail = { points: [], line }; this.trails.set(b.to.id, trail); }
        trail.points.push(p); if (trail.points.length > 60) trail.points.shift();
        trail.line.geometry.dispose(); trail.line.geometry = new T.BufferGeometry().setFromPoints(trail.points.map(p => this.point(p)));
      }
    }
    if (time - this.lastTrail > .04) this.lastTrail = time;
    for (const effect of this.effects) {
      const age = Math.max(0, time - effect.time), duration = effect.launch ? .7 : 3;
      effect.mesh.position.copy(this.point(effect.position)); effect.mesh.scale.setScalar((effect.launch ? 7 : 16) + age * (effect.launch ? 8 : 22));
      (effect.mesh.material as T.MeshBasicMaterial).opacity = Math.max(0, 1 - age / duration);
    }
    this.effects = this.effects.filter(e => { if (time - e.time < (e.launch ? .7 : 3)) return true; this.scene.remove(e.mesh); disposeObject(e.mesh); return false; });
    this.controls.update();
    if (Math.hypot(this.controls.target.x, this.controls.target.z) > 2000) {
      const shift = this.controls.target.clone(); shift.y = 0; this.offset.add(shift); this.camera.position.sub(shift); this.controls.target.sub(shift);
      this.bodies.forEach(b => b.mesh.position.sub(shift)); this.effects.forEach(e => e.mesh.position.sub(shift)); this.lastFollow?.sub(shift);
      this.trails.forEach(t => { t.line.geometry.dispose(); t.line.geometry = new T.BufferGeometry().setFromPoints(t.points.map(p => this.point(p))); });
    }
    this.water.position.x = this.camera.position.x; this.water.position.z = this.camera.position.z;
    this.water.material.uniforms.time.value = time; this.water.material.uniforms.shift.value.set(this.offset.x, this.offset.z);
    this.sun.target.position.copy(this.controls.target); this.sun.position.copy(this.controls.target).add(new T.Vector3(600, 900, -800));
    this.renderer.render(this.scene, this.camera);
    recordWarSimMetric('tactical.render.ms', performance.now() - frameStart);
  };
  dispose() {
    cancelAnimationFrame(this.frame); this.resize.disconnect(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost); this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown); this.renderer.domElement.removeEventListener('pointerup', this.pick);
    void this.audio?.close(); disposeObject(this.scene); this.sun.shadow.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
