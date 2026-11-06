// Borrado con IA (MI-GAN, Picsart AI Research, MIT) sobre onnxruntime-web, en segundo plano para no trabar la pantalla.
// Mensajes: entra { img: Uint8Array CHW, mask: Uint8Array (0 = borrar, 255 = dejar), W, H } → sale { tipo: 'progreso'|'listo'|'error' }.
// onnxruntime-web 1.31.1 (MIT, Microsoft) servido desde el propio sitio: el service worker lo guarda para usarlo sin señal
const ORT = new URL('vendor/ort/', self.location.href).href;
importScripts(ORT + 'ort.wasm.min.js');
ort.env.wasm.wasmPaths = ORT;
const MODELO = new URL('modelos/migan_pipeline_v2.onnx', self.location.href).href, CACHE = 'thirdcedi-ia-v1';
let sesion = null;

async function bajarModelo() {
  const cache = await caches.open(CACHE).catch(() => null);
  const guardado = cache && (await cache.match(MODELO));
  if (guardado) return new Uint8Array(await guardado.arrayBuffer());
  const r = await fetch(MODELO);
  if (!r.ok || !r.body) throw new Error('No se pudo bajar la IA (' + r.status + ')');
  const total = Number(r.headers.get('content-length')) || 28079181, partes = [];
  let bajado = 0;
  const lector = r.body.getReader();
  for (;;) {
    const { done, value } = await lector.read(); if (done) break;
    partes.push(value); bajado += value.length;
    postMessage({ tipo: 'progreso', bajado, total });
  }
  const datos = new Uint8Array(bajado); let o = 0; for (const p of partes) { datos.set(p, o); o += p.length; }
  if (cache) await cache.put(MODELO, new Response(datos, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return datos;
}

onmessage = async ({ data }) => {
  try {
    if (!sesion) {
      const bytes = await bajarModelo();
      postMessage({ tipo: 'progreso', preparando: true });
      sesion = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    }
    const { img, mask, W, H } = data;
    const out = await sesion.run({ image: new ort.Tensor('uint8', img, [1, 3, H, W]), mask: new ort.Tensor('uint8', mask, [1, 1, H, W]) });
    const res = out[sesion.outputNames[0]].data;
    postMessage({ tipo: 'listo', res, W, H }, [res.buffer]);
  } catch (e) {
    postMessage({ tipo: 'error', msg: String(e?.message || e) });
  }
};
