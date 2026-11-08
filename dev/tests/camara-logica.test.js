// Tests de la lógica de la cámara: opciones de video según el teléfono, formato, bitrate, límites y duración.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../camara-logica.js');

test('resoluciones: solo las que da la cámara (también si el track viene en vertical)', () => {
  assert.deepEqual(C.resolucionesSoportadas({ width: { min: 1, max: 1920 }, height: { min: 1, max: 1080 } }), ['720p', '1080p']);
  assert.deepEqual(C.resolucionesSoportadas({ width: { max: 4032 }, height: { max: 3024 } }), ['720p', '1080p', '4k']);
  assert.deepEqual(C.resolucionesSoportadas({ width: { max: 1080 }, height: { max: 1920 } }), ['720p', '1080p']);
  assert.deepEqual(C.resolucionesSoportadas({ width: { max: 640 }, height: { max: 480 } }), ['720p'], 'una cámara chica: 720p como ideal');
  assert.deepEqual(C.resolucionesSoportadas({}), ['720p', '1080p'], 'sin getCapabilities');
  assert.deepEqual(C.resolucionesSoportadas(undefined), ['720p', '1080p']);
});

test('FPS: 24, 30 y 60, solo los que entran en el rango de frameRate', () => {
  assert.deepEqual(C.fpsSoportados({ frameRate: { min: 1, max: 30 } }), [24, 30]);
  assert.deepEqual(C.fpsSoportados({ frameRate: { min: 15, max: 60 } }), [24, 30, 60]);
  assert.deepEqual(C.fpsSoportados({ frameRate: { min: 30, max: 30 } }), [30]);
  assert.deepEqual(C.fpsSoportados({ frameRate: { max: 29.97 } }), [24, 30]);
  assert.deepEqual(C.fpsSoportados({ frameRate: { min: 5, max: 15 } }), [15]);
  assert.deepEqual(C.fpsSoportados({}), [30]);
});

test('formatos: MP4 (H.264) primero si está; si no, un solo WebM (VP9 antes que VP8)', () => {
  const chrome = (m) => /^video\/webm/.test(m) || /^video\/mp4;codecs=avc1/.test(m);
  const f = C.formatosSoportados(chrome);
  assert.deepEqual(f.map((x) => x.id), ['mp4', 'webm-vp9']);
  assert.match(f[0].mime, /^video\/mp4;codecs=avc1/);
  assert.match(f[0].mime, /mp4a/, 'con audio pide el codec de audio');
  assert.doesNotMatch(C.formatosSoportados(chrome, false)[0].mime, /mp4a/, 'sin audio no');
  const viejo = (m) => /^video\/webm(;codecs=vp8(,opus)?)?$/.test(m);
  assert.deepEqual(C.formatosSoportados(viejo).map((x) => x.id), ['webm-vp8']);
  const safari = (m) => /^video\/mp4/.test(m);
  assert.deepEqual(C.formatosSoportados(safari).map((x) => x.id), ['mp4']);
  assert.deepEqual(C.formatosSoportados(() => false), []);
  assert.deepEqual(C.formatosSoportados(() => { throw new Error('x'); }), []);
});

test('bitrate: unos 5, 10 y 35 Mbps, con tope para que 60 s entren en 100 MB', () => {
  assert.equal(C.bitrate('720p', 30), 5e6);
  assert.equal(C.bitrate('1080p', 30), 10e6);
  assert.ok(C.bitrate('1080p', 60) > C.bitrate('1080p', 30));
  assert.ok(C.bitrate('720p', 24) < C.bitrate('720p', 30));
  for (const r of ['720p', '1080p', '4k']) for (const fps of [24, 30, 60]) for (const audio of [true, false]) {
    const total = ((C.bitrate(r, fps, audio) + (audio ? 128000 : 0)) * 60) / 8;
    assert.ok(total <= C.LIMITE_BYTES * 0.9 + 1, `${r} ${fps} ${audio}: ${Math.round(total / 1048576)} MB`);
  }
  assert.ok(C.bitrate('4k', 30) < 35e6, '4K queda topeado');
});

test('normalizar: MP4, 1080p y 30 por defecto; lo guardado se respeta si el teléfono lo da', () => {
  const tel = { resoluciones: ['720p', '1080p', '4k'], fps: [24, 30, 60], formatos: [{ id: 'mp4' }, { id: 'webm-vp9' }] };
  assert.deepEqual(C.normalizar(null, tel), { res: '1080p', fps: 30, formato: 'mp4', audio: true });
  assert.deepEqual(C.normalizar({ res: '4k', fps: 60, formato: 'webm-vp9', audio: false }, tel), { res: '4k', fps: 60, formato: 'webm-vp9', audio: false });
  const chico = { resoluciones: ['720p'], fps: [24, 30], formatos: [{ id: 'webm-vp8' }] };
  assert.deepEqual(C.normalizar({ res: '4k', fps: 60, formato: 'mp4' }, chico), { res: '720p', fps: 30, formato: 'webm-vp8', audio: true });
  assert.equal(C.normalizar({}, { resoluciones: ['720p'], fps: [30], formatos: [] }).formato, null);
});

test('chip, tiempo y restricciones', () => {
  assert.equal(C.chip({ res: '1080p', fps: 30 }), '1080p · 30');
  assert.equal(C.chip({ res: '4k', fps: 60 }), '4K · 60');
  assert.equal(C.tiempo(0), '0:00'); assert.equal(C.tiempo(7900), '0:07'); assert.equal(C.tiempo(60000), '1:00'); assert.equal(C.tiempo(-5), '0:00');
  assert.deepEqual(C.restricciones({ res: '720p', fps: 60 }, { facingMode: 'user' }), { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } });
});

test('límites: aviso a los 50 s, corte a los 60 s o cerca de 100 MB', () => {
  assert.equal(C.DURACION_MAX_MS, 60000); assert.equal(C.LIMITE_BYTES, 100 * 1024 * 1024);
  assert.equal(C.limite(10000, 1e6), null);
  assert.equal(C.limite(50000, 1e6), 'aviso');
  assert.equal(C.limite(60000, 1e6), 'tiempo');
  assert.equal(C.limite(20000, 99.5 * 1024 * 1024), 'tamano');
});

test('extensión y mime base', () => {
  assert.equal(C.extension('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(C.extension('video/webm;codecs=vp9'), 'webm');
  assert.equal(C.mimeBase('video/webm;codecs=vp9,opus'), 'video/webm');
});
