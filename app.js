// VibeSpace player: plays the pre-generated audio and shows each sentence in
// sync with the timestamps in segments.json. Fully client-side.

const startScreen = document.getElementById("start");
const playerScreen = document.getElementById("player");
const beginBtn = document.getElementById("begin");
const replayBtn = document.getElementById("replay");
const finaleEl = document.getElementById("finale");
const stage = document.getElementById("stage");
const progressBar = document.getElementById("progress-bar");
const audio = document.getElementById("audio");

// The audio is split into one mp3 per generated chunk and played as a playlist,
// because byte-concatenated mp3s break duration/`ended` detection in browsers.
let parts = [];
let partIndex = 0;
let segments = []; // segments of the current part (times relative to that part)
let currentIndex = -1;
let totalDuration = 0; // sum of all part durations, for the progress bar
let priorDuration = 0; // duration of parts played before the current one

async function loadSegments() {
  const res = await fetch("segments.json");
  if (!res.ok) throw new Error(`Could not load segments.json: ${res.status}`);
  const data = await res.json();
  parts = data.parts;
  totalDuration = parts.reduce((sum, p) => sum + p.duration, 0);
}

// Load a part and start playing it. Segments and the progress baseline follow.
function startPart(i) {
  partIndex = i;
  segments = parts[i].segments;
  currentIndex = -1;
  priorDuration = parts.slice(0, i).reduce((sum, p) => sum + p.duration, 0);
  audio.src = parts[i].audio;
  audio.play();
}

// Show a sentence with a fade-out/fade-in swap. During pauses (no active
// segment) we keep the last sentence on screen — calmer than blanking.
function showSentence(index) {
  if (index === currentIndex) return;
  currentIndex = index;

  // Swap the text only once the fade-out has finished (matches the 0.3s
  // fade-out in CSS), otherwise the old sentence jumps out half-visible.
  stage.classList.remove("visible");
  window.setTimeout(() => {
    stage.textContent = segments[index].text;
    stage.classList.add("visible");
  }, 300);
}

// Find the segment active at time t. Returns its index, or -1 if we're in a
// gap between sentences.
function segmentAt(t) {
  for (let i = 0; i < segments.length; i++) {
    if (t >= segments[i].start && t < segments[i].end) return i;
  }
  return -1;
}

function onTimeUpdate() {
  const t = audio.currentTime;
  const index = segmentAt(t);
  if (index !== -1) showSentence(index);

  // Drive the accumulating chaos from the global playback position.
  Chaos.update(priorDuration + t);

  if (totalDuration) {
    progressBar.style.width = `${((priorDuration + t) / totalDuration) * 100}%`;
  }
}

function start() {
  startScreen.classList.add("hidden");
  playerScreen.classList.remove("hidden");
  Chaos.reset();
  startPart(0);
}

function replay() {
  replayBtn.classList.add("hidden");
  Chaos.reset();
  startPart(0);
}

// Tap or space toggles pause/resume while playing.
function togglePause() {
  if (audio.ended) return;
  if (audio.paused) audio.play();
  else audio.pause();
}

audio.addEventListener("timeupdate", onTimeUpdate);

audio.addEventListener("ended", () => {
  // Move on to the next part; only finish once the last part has played.
  if (partIndex + 1 < parts.length) {
    startPart(partIndex + 1);
    return;
  }
  // The white-out finale is normally triggered by the timeline; ensure it's up
  // (e.g. on very short audio) and reveal the replay affordance.
  stage.classList.remove("visible");
  Chaos.finale();
  replayBtn.classList.remove("hidden");
});

beginBtn.addEventListener("click", start);
replayBtn.addEventListener("click", replay);

playerScreen.addEventListener("click", (e) => {
  // Don't toggle pause once the finale is showing.
  if (!finaleEl.classList.contains("hidden")) return;
  togglePause();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !playerScreen.classList.contains("hidden")) {
    e.preventDefault();
    if (finaleEl.classList.contains("hidden")) togglePause();
  }
});

loadSegments().catch((err) => {
  stage.textContent =
    "Kon segments.json niet laden — draai eerst generate.mjs en serveer de map via een lokale server.";
  stage.classList.add("visible");
  console.error(err);
});
