const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '../public/sounds');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function createWavBuffer(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); // Block Align
  buffer.writeUInt16LE(16, 34); // 16-bit
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(val, 44 + i * 2);
  }
  return buffer;
}

const sampleRate = 22050;

// 1. beep.wav
const beepSamples = [];
const beepDur = 0.15;
for (let i = 0; i < sampleRate * beepDur; i++) {
  const t = i / sampleRate;
  const env = Math.exp(-t * 15);
  beepSamples.push(Math.sin(2 * Math.PI * 800 * t) * env * 0.4);
}
fs.writeFileSync(path.join(outputDir, 'beep.wav'), createWavBuffer(beepSamples, sampleRate));

// 2. whoosh.wav (skip)
const whooshSamples = [];
const whooshDur = 0.25;
const whooshLen = sampleRate * whooshDur;
for (let i = 0; i < whooshLen; i++) {
  const t = i / sampleRate;
  const progress = t / whooshDur;
  const phase = 2 * Math.PI * (1200 * t - 1000 * t * t / (2 * whooshDur));
  const env = Math.sin(Math.PI * progress);
  whooshSamples.push(Math.sin(phase) * env * 0.4);
}
fs.writeFileSync(path.join(outputDir, 'whoosh.wav'), createWavBuffer(whooshSamples, sampleRate));

// 3. flip.wav (reverse)
const flipSamples = [];
const flipDur = 0.15;
for (let i = 0; i < sampleRate * flipDur; i++) {
  const t = i / sampleRate;
  let s = 0;
  if (t < 0.02) {
    s += Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 200);
  }
  if (t > 0.05 && t < 0.07) {
    const t2 = t - 0.05;
    s += Math.sin(2 * Math.PI * 1800 * t2) * Math.exp(-t2 * 200);
  }
  flipSamples.push(s * 0.5);
}
fs.writeFileSync(path.join(outputDir, 'flip.wav'), createWavBuffer(flipSamples, sampleRate));

// 4. power.wav (+2)
const powerSamples = [];
const powerDur = 0.3;
const powerLen = sampleRate * powerDur;
for (let i = 0; i < powerLen; i++) {
  const t = i / sampleRate;
  const progress = t / powerDur;
  const phase1 = 2 * Math.PI * (300 * t + 500 * t * t / (2 * powerDur));
  const phase2 = 2 * Math.PI * (450 * t + 750 * t * t / (2 * powerDur));
  const env = Math.sin(Math.PI * progress);
  powerSamples.push((Math.sin(phase1) + Math.sin(phase2)) * 0.25 * env);
}
fs.writeFileSync(path.join(outputDir, 'power.wav'), createWavBuffer(powerSamples, sampleRate));

// 5. magic.wav (wild)
const magicSamples = [];
const magicDur = 0.45;
const magicLen = sampleRate * magicDur;
for (let i = 0; i < magicLen; i++) {
  const t = i / sampleRate;
  let s = 0;
  s += Math.sin(2 * Math.PI * 523.25 * t) * Math.exp(-t * 8);
  if (t >= 0.08) {
    s += Math.sin(2 * Math.PI * 659.25 * (t - 0.08)) * Math.exp(-(t - 0.08) * 8);
  }
  if (t >= 0.16) {
    s += Math.sin(2 * Math.PI * 783.99 * (t - 0.16)) * Math.exp(-(t - 0.16) * 8);
  }
  if (t >= 0.24) {
    s += Math.sin(2 * Math.PI * 1046.50 * (t - 0.24)) * Math.exp(-(t - 0.24) * 8);
  }
  magicSamples.push(s * 0.15);
}
fs.writeFileSync(path.join(outputDir, 'magic.wav'), createWavBuffer(magicSamples, sampleRate));

// 6. boom.wav (wild +4)
const boomSamples = [];
const boomDur = 0.6;
const boomLen = sampleRate * boomDur;
for (let i = 0; i < boomLen; i++) {
  const t = i / sampleRate;
  const noise = Math.random() * 2 - 1;
  const rumble = Math.sin(2 * Math.PI * (80 - t * 40) * t);
  const envNoise = Math.exp(-t * 8);
  const envRumble = Math.exp(-t * 4);
  boomSamples.push((noise * envNoise * 0.2) + (rumble * envRumble * 0.5));
}
fs.writeFileSync(path.join(outputDir, 'boom.wav'), createWavBuffer(boomSamples, sampleRate));

// 7. uno.wav (uno voice chime)
const unoSamples = [];
const unoDur = 0.35;
for (let i = 0; i < sampleRate * unoDur; i++) {
  const t = i / sampleRate;
  let s = 0;
  if (t < 0.15) {
    const env = Math.sin(Math.PI * (t / 0.15));
    s += Math.sin(2 * Math.PI * (200 + 150 * (t / 0.15)) * t) * env;
  }
  if (t >= 0.15) {
    const t2 = t - 0.15;
    const env = Math.sin(Math.PI * (t2 / 0.20));
    s += Math.sin(2 * Math.PI * (380 + 120 * (t2 / 0.20)) * t2) * env;
  }
  unoSamples.push(s * 0.35);
}
fs.writeFileSync(path.join(outputDir, 'uno.wav'), createWavBuffer(unoSamples, sampleRate));

// 8. victory.wav (winner fanfare)
const victorySamples = [];
const victoryDur = 0.8;
const victoryLen = sampleRate * victoryDur;
for (let i = 0; i < victoryLen; i++) {
  const t = i / sampleRate;
  let s = 0;
  if (t >= 0 && t < 0.15) {
    s += Math.sin(2 * Math.PI * 392.00 * t);
  }
  if (t >= 0.15 && t < 0.3) {
    s += Math.sin(2 * Math.PI * 523.25 * (t - 0.15));
  }
  if (t >= 0.3 && t < 0.45) {
    s += Math.sin(2 * Math.PI * 659.25 * (t - 0.3));
  }
  if (t >= 0.45) {
    const t2 = t - 0.45;
    const env = Math.exp(-t2 * 4);
    s += (
      Math.sin(2 * Math.PI * 523.25 * t2) +
      Math.sin(2 * Math.PI * 659.25 * t2) +
      Math.sin(2 * Math.PI * 783.99 * t2) +
      Math.sin(2 * Math.PI * 1046.50 * t2)
    ) * 0.2 * env;
  }
  victorySamples.push(s * 0.3);
}
fs.writeFileSync(path.join(outputDir, 'victory.wav'), createWavBuffer(victorySamples, sampleRate));

// 9. draw.wav (card draw)
const drawSamples = [];
const drawDur = 0.15;
for (let i = 0; i < sampleRate * drawDur; i++) {
  const t = i / sampleRate;
  const progress = t / drawDur;
  const phase = 2 * Math.PI * (200 * t + 250 * t * t / (2 * drawDur));
  const env = Math.sin(Math.PI * progress);
  drawSamples.push(Math.sin(phase) * env * 0.3);
}
fs.writeFileSync(path.join(outputDir, 'draw.wav'), createWavBuffer(drawSamples, sampleRate));

// 10. deal.wav (card deal)
const dealSamples = [];
const dealDur = 0.08;
for (let i = 0; i < sampleRate * dealDur; i++) {
  const t = i / sampleRate;
  const env = Math.exp(-t * 50);
  const noise = Math.random() * 2 - 1;
  const freq = 1000 - t * 4000;
  dealSamples.push((Math.sin(2 * Math.PI * freq * t) * 0.5 + noise * 0.5) * env * 0.3);
}
fs.writeFileSync(path.join(outputDir, 'deal.wav'), createWavBuffer(dealSamples, sampleRate));

// 11. catch.wav (catch UNO)
const catchSamples = [];
const catchDur = 0.25;
for (let i = 0; i < sampleRate * catchDur; i++) {
  const t = i / sampleRate;
  const progress = t / catchDur;
  const phase = 2 * Math.PI * (600 * t - 300 * t * t / (2 * catchDur));
  const env = Math.sin(Math.PI * progress);
  catchSamples.push(Math.sin(phase) * env * 0.3);
}
fs.writeFileSync(path.join(outputDir, 'catch.wav'), createWavBuffer(catchSamples, sampleRate));

// 12. unoAlert.wav (UNO button warning)
const unoAlertSamples = [];
const unoAlertDur = 0.25;
for (let i = 0; i < sampleRate * unoAlertDur; i++) {
  const t = i / sampleRate;
  const progress = t / unoAlertDur;
  const phase = 2 * Math.PI * (880 * t);
  const env = Math.sin(Math.PI * progress);
  unoAlertSamples.push(Math.sin(phase) * env * 0.35);
}
fs.writeFileSync(path.join(outputDir, 'unoAlert.wav'), createWavBuffer(unoAlertSamples, sampleRate));

console.log('Successfully generated all 12 sound files in public/sounds!');
