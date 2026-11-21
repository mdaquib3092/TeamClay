import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// An Opus Ogg stream's end granule is on a 48 kHz clock. Only send complete,
// single-stream notes known to be below Sarvam's 30-second REST limit.
export function shortOpus(audio) {
  if (audio.length < 47 || audio.length > 3 * 1024 * 1024) return false;
  let pos = 0, stream, endGranule = 0n, eos = false, sequence = 0, completePacket = false;
  while (pos < audio.length) {
    if (eos || pos + 27 > audio.length || audio.toString("ascii", pos, pos + 4) !== "OggS" || audio[pos + 4] !== 0) return false;
    const segmentsEnd = pos + 27 + audio[pos + 26];
    if (segmentsEnd > audio.length) return false;
    let end = segmentsEnd;
    for (let i = pos + 27; i < segmentsEnd; i++) end += audio[i];
    if (end > audio.length) return false;
    const serial = audio.readUInt32LE(pos + 14);
    if (audio.readUInt32LE(pos + 18) !== sequence++) return false;
    if (pos === 0) {
      if (!(audio[pos + 5] & 2) || end - segmentsEnd < 19 ||
          !audio.subarray(segmentsEnd, segmentsEnd + 8).equals(Buffer.from("OpusHead"))) return false;
      stream = serial;
    } else if (stream !== serial) return false;
    endGranule = audio.readBigInt64LE(pos + 6);
    eos = !!(audio[pos + 5] & 4);
    completePacket = audio[pos + 26] > 0 && audio[segmentsEnd - 1] < 255;
    pos = end;
  }
  // WhatsApp mobile recordings can omit the final EOS flag. Their source
  // hash is already verified; accept a complete final page/packet at EOF.
  return completePacket && endGranule > 0n && endGranule < 30n * 48000n;
}

// afconvert can emit WAVE_FORMAT_EXTENSIBLE for mono Opus. Send a conventional
// PCM header and check the real decoded length, not just the input granule.
function standardWav(file) {
  if (file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") return null;
  let pcm, formatOK = false;
  for (let p = 12; p + 8 <= file.length;) {
    const tag = file.toString("ascii", p, p + 4), size = file.readUInt32LE(p + 4);
    p += 8;
    if (p + size > file.length) return null;
    if (tag === "fmt " && size >= 16) {
      const format = file.readUInt16LE(p);
      formatOK = (format === 1 || (format === 65534 && size >= 40 && file.readUInt32LE(p + 24) === 1)) &&
        file.readUInt16LE(p + 2) === 1 && file.readUInt32LE(p + 4) === 16000 &&
        file.readUInt16LE(p + 12) === 2 && file.readUInt16LE(p + 14) === 16;
    } else if (tag === "data") pcm = file.subarray(p, p + size);
    p += size + (size % 2);
  }
  if (!formatOK || !pcm?.length || pcm.length % 2 || pcm.length >= 30 * 32000) return null;
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Core Audio is available on the bridge Mac. Longer/unsupported audio stays
// on the batch route. The original WhatsApp file is never edited or logged.
export async function shortVoiceWav(audio, scratchRoot) {
  if (!shortOpus(audio) || process.platform !== "darwin") return null;
  const dir = await fs.mkdtemp(path.join(scratchRoot, ".voice-convert-"));
  try {
    const input = path.join(dir, "note.ogg"), output = path.join(dir, "note.wav");
    await fs.writeFile(input, audio, { mode: 0o600 });
    try {
      await run("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", input, output], { timeout: 15000 });
    } catch { return null; }
    if ((await fs.stat(output)).size > 1024 * 1024) return null;
    return standardWav(await fs.readFile(output));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
