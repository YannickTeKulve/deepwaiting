// One-time generation script for VibeSpace.
//
// Converts speech.txt into a spoken audio file + per-sentence timestamps using
// ElevenLabs, so the static site only ever loads the pre-generated assets.
//
// The API key is read from the ELEVENLABS_API_KEY environment variable and is
// NEVER written into any file the site ships.
//
// Usage:
//   node generate.mjs --voices                       # list your voices + ids
//   ELEVENLABS_API_KEY=xxx node generate.mjs         # generate audio + timestamps
//   ELEVENLABS_API_KEY=xxx node generate.mjs --voice=<id>
//
// Requires Node 18+ (native fetch).

import { readFile, writeFile } from "node:fs/promises";

const API_BASE = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_v3";
const OUTPUT_FORMAT = "mp3_44100_128";
const BITRATE = 128000; // bits/s of OUTPUT_FORMAT (CBR) — used to derive chunk duration from byte length
const MAX_CHARS = 4500; // stay safely under the v3 per-request limit of 5000
const STABILITY = 0.0; // Eleven v3 stability mode: 0.0 = Creative, 0.5 = Natural, 1.0 = Robust
const PAUSE_MARKER = "(...)"; // inserted on each blank line for a short pause

// Fill in your voice id here, or pass --voice=<id> on the command line.
let VOICE_ID = "6bPfTtSpgxgD0GeBVfqu";

const API_KEY = process.env.ELEVENLABS_API_KEY;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// --- list voices ------------------------------------------------------------

async function listVoices() {
  if (!API_KEY) fail("ELEVENLABS_API_KEY is not set.");
  const res = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": API_KEY },
  });
  if (!res.ok) fail(`Voices request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log("\nYour voices:\n");
  for (const v of data.voices) {
    console.log(`  ${v.name.padEnd(24)} ${v.voice_id}`);
  }
  console.log("\nCopy the voice_id you want into VOICE_ID (or use --voice=<id>).\n");
}

// --- build the text + sentence offset map -----------------------------------

// Reads speech.txt, treats each non-empty line as one sentence, and joins them
// with a pause marker on the blank lines between them. Returns the full string
// sent to ElevenLabs plus, per sentence, its [start, end) character offsets in
// that string.
// that chunk's string. v3 caps a request at 5000 chars, so sentences are grouped
// into chunks of at most MAX_CHARS and each chunk is generated separately.
function buildChunks(raw) {
  const sentences = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const chunks = [];
  let text = "";
  let spans = [];

  const flush = () => {
    if (text.length > 0) chunks.push({ text, spans });
    text = "";
    spans = [];
  };

  for (const sentence of sentences) {
    const sep = text.length > 0 ? `\n${PAUSE_MARKER}\n` : "";
    if (text.length + sep.length + sentence.length > MAX_CHARS) flush();
    const prefix = text.length > 0 ? `\n${PAUSE_MARKER}\n` : "";
    text += prefix;
    const start = text.length;
    text += sentence;
    spans.push({ text: sentence, start, end: text.length }); // end is exclusive
  }
  flush();

  return chunks;
}

// --- map character timestamps onto whole sentences --------------------------

// Maps each sentence span to its start/end time. Times are relative to this
// chunk's own audio file (each chunk is shipped as a separate mp3).
function toSegments(spans, alignment) {
  const startTimes = alignment.character_start_times_seconds;
  const endTimes = alignment.character_end_times_seconds;

  return spans.map(({ text, start, end }) => ({
    text,
    start: startTimes[start],
    // end offset is exclusive, so the last character of the sentence is end - 1
    end: endTimes[end - 1],
  }));
}

// --- request a single chunk -------------------------------------------------

async function requestChunk(text) {
  const res = await fetch(
    `${API_BASE}/text-to-speech/${VOICE_ID}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: STABILITY },
      }),
    }
  );

  if (!res.ok) fail(`TTS request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const alignment = data.alignment;
  if (!alignment) fail("Response contained no alignment data.");

  // Sanity check: alignment characters must map 1:1 onto the text we sent,
  // otherwise the offset-based sentence timing would be wrong.
  if (alignment.characters.join("") !== text) {
    fail("Alignment characters do not match the sent text 1:1 — cannot map timestamps safely.");
  }

  return { audio: Buffer.from(data.audio_base64, "base64"), alignment };
}

// --- generate ---------------------------------------------------------------

async function generate() {
  if (!API_KEY) fail("ELEVENLABS_API_KEY is not set.");
  if (VOICE_ID === "REPLACE_WITH_VOICE_ID") {
    fail("No voice id set. Run `node generate.mjs --voices` and set VOICE_ID or pass --voice=<id>.");
  }

  const raw = await readFile(new URL("./speech.txt", import.meta.url), "utf8");
  const chunks = buildChunks(raw);
  const totalSentences = chunks.reduce((n, c) => n + c.spans.length, 0);
  console.log(`Sending ${totalSentences} sentences in ${chunks.length} chunk(s) to ElevenLabs...`);

  // Each chunk is kept as its own standalone mp3 and played back-to-back in the
  // browser (a playlist). Byte-concatenating mp3s produces a file with multiple
  // headers that browsers mis-read (wrong duration, early `ended`), so we don't.
  const parts = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`  chunk ${i + 1}/${chunks.length} (${chunk.text.length} chars, ${chunk.spans.length} sentences)`);
    const { audio, alignment } = await requestChunk(chunk.text);

    const name = `audio_${i + 1}.mp3`;
    await writeFile(new URL(`./${name}`, import.meta.url), audio);
    parts.push({
      audio: name,
      duration: (audio.length * 8) / BITRATE, // CBR: byte length → seconds, for the progress bar
      segments: toSegments(chunk.spans, alignment),
    });
  }

  await writeFile(
    new URL("./segments.json", import.meta.url),
    JSON.stringify({ parts }, null, 2)
  );

  const totalSegments = parts.reduce((n, p) => n + p.segments.length, 0);
  console.log(`✔ Wrote ${parts.length} audio file(s) and segments.json (${totalSegments} segments).`);
}

// --- entry point ------------------------------------------------------------

const args = process.argv.slice(2);
const voiceArg = args.find((a) => a.startsWith("--voice="));
if (voiceArg) VOICE_ID = voiceArg.split("=")[1];

if (args.includes("--voices")) {
  await listVoices();
} else {
  await generate();
}
