// DeepWaiting — visual escalation layer.
//
// The narration stays calm; the screen slowly fills with dev-chaos that appears
// exactly when the narrator mentions it, then never leaves. Everything is driven
// by the global playback time (Chaos.update) and fully reset on replay.

const Chaos = (() => {
  const layer = document.getElementById("chaos");
  const breathing = document.getElementById("breathing");
  const finaleEl = document.getElementById("finale");
  const etaEl = document.getElementById("eta");

  let intervals = [];
  let firedIndex = 0;
  let refs = {}; // widgets that later timeline events update

  // --- low-level helpers ----------------------------------------------------

  const rnd = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // Run fn every ms; tracked so reset() can stop it. Auto-stops after `times`.
  function every(ms, times, fn) {
    let n = 0;
    const id = setInterval(() => {
      fn(n);
      if (++n >= times) clearInterval(id);
    }, ms);
    intervals.push(id);
    return id;
  }

  // Fixed slots around the edges — keeps big windows from overlapping and
  // leaves the central column (the "eye of the storm") clear for the narration.
  const SLOTS = [
    { top: "3%", left: "1.5%" },
    { top: "3%", right: "1.5%" },
    { top: "27%", left: "1.5%" },
    { top: "27%", right: "1.5%" },
    { top: "50%", left: "1.5%" },
    { top: "50%", right: "1.5%" },
    { top: "72%", left: "1.5%" },
    { top: "72%", right: "1.5%" },
    { bottom: "3%", left: "30%" },
    { bottom: "3%", left: "52%" },
  ];
  let slotIdx = 0;
  function placeInSlot(node) {
    const s = SLOTS[slotIdx % SLOTS.length];
    // On the rare wrap-around, nudge down a little so it doesn't sit exactly on top.
    const wrap = Math.floor(slotIdx / SLOTS.length) * 4;
    slotIdx++;
    if (s.top != null) node.style.top = `calc(${s.top} + ${wrap}%)`;
    if (s.bottom != null) node.style.bottom = s.bottom;
    if (s.left != null) node.style.left = s.left;
    if (s.right != null) node.style.right = s.right;
    return node;
  }

  // Small, tiny things (chips, bubbles) may scatter loosely in the edge bands.
  const ZONES = [
    { top: [6, 20], left: [3, 16] },
    { top: [8, 18], left: [62, 82] },
    { top: [80, 90], left: [20, 40] },
    { top: [82, 90], left: [56, 76] },
  ];
  function scatterInto(node, zone) {
    const z = zone || pick(ZONES);
    node.style.top = rnd(z.top[0], z.top[1]).toFixed(1) + "%";
    node.style.left = rnd(z.left[0], z.left[1]).toFixed(1) + "%";
    return node;
  }

  // Append to the chaos layer with a gentle fade-in.
  function spawn(node) {
    layer.appendChild(node);
    requestAnimationFrame(() => node.classList.add("in"));
    return node;
  }

  // --- widget factory -------------------------------------------------------

  // A glassy dev window with a traffic-light title bar and a body.
  function windowAt(title, { w } = {}) {
    const win = el("div", "win");
    if (w) win.style.width = w;
    win.appendChild(
      el(
        "div",
        "win-bar",
        `<span class="dot"></span><span class="dot"></span><span class="dot"></span><b>${title}</b>`
      )
    );
    const body = el("div", "win-body");
    win.appendChild(body);
    placeInSlot(win);
    spawn(win);
    return { win, body };
  }

  // Terminal window that scrolls appended lines (keeps the last ~14).
  function terminal(title) {
    const { body } = windowAt(title, { w: "260px" });
    body.classList.add("term");
    return {
      line(text, cls) {
        const row = el("div", "term-line" + (cls ? " " + cls : ""), text);
        body.appendChild(row);
        while (body.childNodes.length > 14) body.removeChild(body.firstChild);
        body.scrollTop = body.scrollHeight;
      },
    };
  }

  // Feed a list of lines into a terminal on an interval.
  function feed(term, lines, ms = 1600) {
    every(ms, lines.length, (n) => term.line(lines[n]));
  }

  // A small pill (status text) near the top.
  function statusPill(text) {
    const pill = el("div", "pill", text);
    pill.style.top = "3%";
    pill.style.left = "50%";
    pill.style.transform = "translateX(-50%)";
    spawn(pill);
    return { set: (t) => (pill.textContent = t) };
  }

  // A notification that fades in and stacks (never leaves).
  const toastStack = () => {
    let box = document.getElementById("toast-stack");
    if (!box) {
      box = el("div", "toast-stack");
      box.id = "toast-stack";
      layer.appendChild(box);
    }
    return box;
  };
  function toast(text) {
    const box = toastStack();
    const t = el("div", "toast", text);
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    while (box.childNodes.length > 8) box.removeChild(box.firstChild);
  }

  // A growing git graph.
  function gitGraph() {
    const { body } = windowAt("git log --oneline", { w: "230px" });
    body.classList.add("git");
    return {
      commit(name) {
        const row = el("div", "git-row", `<span class="git-node"></span><code>${name}</code>`);
        body.appendChild(row);
        while (body.childNodes.length > 14) body.removeChild(body.firstChild);
        body.scrollTop = body.scrollHeight;
      },
    };
  }

  // A dashboard: one window holding a grid of metric tiles (no overlap).
  function dashboardGrid(title) {
    const { body } = windowAt(title, { w: "260px" });
    body.classList.add("dash-grid");
    return {
      // Add a tile and return handles to animate it.
      tile(label, unit = "%") {
        const tile = el("div", "dash-tile");
        const name = el("div", "dash-label", label);
        const value = el("div", "dash-value", "0" + unit);
        const barWrap = el("div", "metric-bar");
        const bar = el("i");
        barWrap.appendChild(bar);
        tile.appendChild(name);
        tile.appendChild(value);
        tile.appendChild(barWrap);
        body.appendChild(tile);
        return {
          set(v) {
            value.textContent = v + unit;
            bar.style.width = Math.min(100, v) + "%";
            bar.style.background = v > 90 ? "#ff5b5b" : v > 60 ? "#ffb020" : "#59d98a";
          },
          note(text) {
            tile.appendChild(el("div", "metric-note", text));
          },
        };
      },
    };
  }

  // Agent counter that keeps climbing.
  function agentCounter() {
    const wrap = el("div", "agents");
    wrap.innerHTML = `<div class="agents-n">3</div><div class="agents-l">agents thinking</div>`;
    placeInSlot(wrap);
    spawn(wrap);
    const n = wrap.querySelector(".agents-n");
    return {
      set: (v) => (n.textContent = v),
      note(text) {
        wrap.appendChild(el("div", "agents-note", text));
      },
    };
  }

  // Architecture diagram: boxes that keep connecting to everything with arrows.
  function archDiagram() {
    const { win, body } = windowAt("architecture.drawio", { w: "260px" });
    win.classList.add("wide");
    body.classList.add("arch");

    const SVG = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "arch-lines");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    // arrowhead marker
    svg.innerHTML =
      '<defs><marker id="ah" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">' +
      '<path d="M0,0 L4,2 L0,4 z" fill="rgba(150,180,255,0.6)"/></marker></defs>';
    body.appendChild(svg);

    const kinds = ["Service", "Gateway", "Queue", "Cache", "DB", "Adapter", "Factory", "Registry", "Resolver", "EventBus"];
    const nodes = []; // {x, y} centres in the 0–100 viewBox space

    return {
      grow() {
        const x = rnd(10, 86);
        const y = rnd(12, 84);
        const b = el("div", "arch-box", pick(kinds) + "-" + Math.floor(rnd(1, 99)));
        b.style.left = x + "%";
        b.style.top = y + "%";
        body.appendChild(b);

        // Connect the new box to a random existing one (everything connects…).
        if (nodes.length) {
          const from = pick(nodes);
          const ln = document.createElementNS(SVG, "line");
          ln.setAttribute("x1", from.x);
          ln.setAttribute("y1", from.y);
          ln.setAttribute("x2", x);
          ln.setAttribute("y2", y);
          ln.setAttribute("marker-end", "url(#ah)");
          svg.appendChild(ln);
          while (svg.querySelectorAll("line").length > 26) {
            svg.querySelector("line").remove();
          }
        }
        nodes.push({ x, y });

        const boxes = body.querySelectorAll(".arch-box");
        if (boxes.length > 16) {
          boxes[0].remove();
          nodes.shift();
        }
      },
    };
  }

  // A flamegraph: stacked rows of coloured segments that keep piling up.
  function flamegraph() {
    const { body } = windowAt("flamegraph.svg", { w: "260px" });
    body.classList.add("flame");
    const palette = ["#e8794a", "#e8a24a", "#d9c24a", "#b0d94a", "#e86a4a", "#e8b34a", "#c94ae8"];
    const row = () => {
      const r = el("div", "flame-row");
      let w = 0;
      while (w < 100) {
        const seg = Math.min(rnd(8, 34), 100 - w);
        w += seg;
        const s = el("i");
        s.style.width = seg + "%";
        s.style.background = pick(palette);
        r.appendChild(s);
      }
      return r;
    };
    for (let i = 0; i < 5; i++) body.appendChild(row());
    return {
      grow() {
        body.appendChild(row());
        while (body.querySelectorAll(".flame-row").length > 9) {
          body.querySelector(".flame-row").remove();
        }
      },
    };
  }

  // Floating AI chat bubbles that disagree with each other.
  function chatBubble(who, text) {
    const b = el("div", "bubble", `<b>${who}</b>${text}`);
    scatterInto(b);
    spawn(b);
  }

  // A browser window whose tabs multiply.
  function browserTabs() {
    const { body } = windowAt("Chromium — 1 of many", { w: "260px" });
    body.classList.add("tabs");
    return {
      tab(name) {
        body.appendChild(el("span", "tab", name));
        while (body.childNodes.length > 16) body.removeChild(body.firstChild);
      },
    };
  }

  // --- the timeline ---------------------------------------------------------
  // Times are global playback seconds and line up with what the narrator says.

  const TIMELINE = [
    { at: 20, run: () => (refs.pill = statusPill("3 agents are thinking…")) },

    // 0:45 — quiet productivity: notifications drift in
    {
      at: 45,
      run: () => {
        const notes = [
          "Claude started reasoning…",
          "Codex is exploring alternatives…",
          "OpenCode created worktree-17…",
          "Gemini joined the session…",
        ];
        every(4000, notes.length, (n) => toast(notes[n]));
      },
    },

    // 0:58 — the first innocent terminal
    {
      at: 59,
      run: () => {
        refs.term = terminal("bash — analysis");
        feed(refs.term, [
          "Analyzing repository…",
          "Finding improvements…",
          "Reading entire codebase…",
          "Creating implementation plan…",
          "Found 17 opportunities for improvement.",
        ], 2600);
      },
    },

    // 1:44 — the first refactor cascade
    {
      at: 105,
      run: () => {
        feed(
          refs.term,
          [
            "Refactoring helper…",
            "Extracting interface…",
            "Creating abstraction…",
            "Improving architecture…",
            "Actually…",
            "Creating better abstraction…",
            "Introducing CQRS…",
            "Adding event sourcing…",
            "Suggesting rewrite in Rust…",
          ],
          2400
        );
      },
    },

    // 2:27 — architecture starts sprawling
    {
      at: 148,
      run: () => {
        refs.arch = archDiagram();
        every(3200, 6, () => refs.arch.grow());
      },
    },

    // 2:47 — the pull request
    {
      at: 168,
      run: () => {
        const { body } = windowAt("Pull Request #1", { w: "230px" });
        body.classList.add("pr");
        body.innerHTML =
          '<div class="pr-stat">4,892 <span>files changed</span></div>' +
          '<div class="pr-diff"><span class="add">+284,119</span> <span class="del">−11</span></div>';
        refs.pr = body;
      },
    },

    // 3:35 — abstraction explodes
    { at: 215, run: () => refs.arch && every(1600, 12, () => refs.arch.grow()) },

    // 4:35 — the tests
    { at: 275, run: () => toast("Coverage: 100% — failing tests deleted ✓") },

    // 4:55 — dependency hell
    {
      at: 296,
      run: () => {
        const term = terminal("npm install");
        const marks = [1, 42, 314, 921, 1487];
        every(1500, marks.length, (n) => term.line(`${marks[n]} / 1487 packages…`));
        setTimeout(() => {
          term.line("1487 packages installed.");
          term.line("1486 packages outdated.", "warn");
          term.line("1485 packages deprecated.", "warn");
          term.line("1,487 packages are looking for funding.", "warn");
        }, 8000);
      },
    },

    // 5:25 — dashboard syndrome (one grid panel, tiles never overlap)
    {
      at: 325,
      run: () => {
        refs.dash = dashboardGrid("Observability");
        [
          ["Monitoring", "%"],
          ["Traces", "k"],
          ["Tokens", "k"],
          ["Cost", "$"],
        ].forEach(([label, unit]) => {
          const t = refs.dash.tile(label, unit);
          let v = 0;
          every(2000, 8, () => t.set((v += Math.floor(rnd(6, 22)))));
        });
      },
    },

    // 5:40 — enterprise mode: a flamegraph nobody reads
    {
      at: 340,
      run: () => {
        const f = flamegraph();
        every(2500, 6, () => f.grow());
      },
    },

    // 6:22 — CPU to the moon (added as a tile on the same dashboard)
    {
      at: 382,
      run: () => {
        const cpu = refs.dash ? refs.dash.tile("CPU", "%") : dashboardGrid("CPU").tile("CPU", "%");
        const seq = [12, 18, 29, 47, 72, 98, 100, 103];
        every(1500, seq.length, (n) => cpu.set(seq[n]));
        setTimeout(() => cpu.note("Borrowing neighboring CPU…"), 13000);
      },
    },

    // 6:35 — cloud native recursion
    {
      at: 395,
      run: () => {
        const term = terminal("kubectl apply");
        feed(
          term,
          [
            "Provisioning Kubernetes…",
            "Creating cluster…",
            "Creating management cluster…",
            "Creating management cluster for management cluster…",
            "Creating backup management cluster…",
            "Creating cluster to manage the backups…",
          ],
          2600
        );
      },
    },

    // 8:46 — git comes alive
    {
      at: 526,
      run: () => {
        refs.git = gitGraph();
        const names = [
          "refactor", "cleanup", "cleanup-final", "cleanup-final-v2",
          "real-final", "real-final-fixed", "actually-final", "one-more-cleanup",
          "small-improvement", "final-final-v3",
        ];
        every(2200, names.length, (n) => refs.git.commit(names[n]));
      },
    },

    // 10:05 — automated PR review comments
    {
      at: 606,
      run: () => {
        const comments = [
          "Could this be more generic?",
          "Needs another abstraction.",
          "Please consider event sourcing.",
          "Have we thought about scale?",
        ];
        every(3000, comments.length, (n) => {
          if (refs.pr) refs.pr.appendChild(el("div", "pr-comment", "💬 " + comments[n]));
        });
      },
    },

    // 11:02 — the AI roundtable + agent explosion + browser meltdown
    {
      at: 662,
      run: () => {
        const round = [
          ["Claude", "Alternative approach…"],
          ["Codex", "Actually, let's rethink this."],
          ["Gemini", "Migrate everything to Google Cloud."],
          ["Claude", "Complete rewrite recommended."],
          ["Codex", "This changes everything."],
        ];
        every(3400, round.length, (n) => chatBubble(round[n][0], round[n][1]));

        refs.agents = agentCounter();
        const counts = [5, 11, 18, 42, 97, 183];
        every(2000, counts.length, (n) => {
          refs.agents.set(counts[n]);
          if (counts[n] === 97) refs.agents.note("Agent #41 created helper agents.");
          if (counts[n] === 183) refs.agents.note("183 reasoning sessions active.");
        });

        refs.tabs = browserTabs();
        const tabs = [
          "README", "README-final", "README-final-v2", "README-final-v2-fixed",
          "Architecture", "Architecture-new", "Architecture-final",
          "Architecture-final-real", "Architecture-final-real-fixed",
        ];
        every(1400, tabs.length, (n) => refs.tabs.tab(tabs[n]));
      },
    },

    // 11:24 — peak chaos ambience
    {
      at: 684,
      run: () => {
        toast("GitHub Actions: all checks failed ✗");
        toast("Slack: 12 new mentions");
        toast("Calendar: 'Quick sync' in 5 min");
        every(1200, 10, () => {
          const t = el("div", "thinking-chip", "Thinking…");
          scatterInto(t, pick(ZONES));
          spawn(t);
        });
      },
    },

    // 11:39 — "Take one final deep breath." Everything stops.
    { at: 699, run: () => Chaos.finale() },

    // ~11:52 — the estimate that never changes (a few beats after the cursor)
    { at: 712, run: () => etaEl.classList.remove("hidden") },
  ];

  // --- public API -----------------------------------------------------------

  function update(elapsed) {
    while (firedIndex < TIMELINE.length && TIMELINE[firedIndex].at <= elapsed) {
      try {
        TIMELINE[firedIndex].run();
      } catch (e) {
        console.error("chaos event failed", e);
      }
      firedIndex++;
    }
  }

  function finale() {
    breathing.classList.add("hidden");
    finaleEl.classList.remove("hidden");
    requestAnimationFrame(() => finaleEl.classList.add("in"));
  }

  function reset() {
    intervals.forEach(clearInterval);
    intervals = [];
    layer.innerHTML = "";
    firedIndex = 0;
    slotIdx = 0;
    refs = {};
    finaleEl.classList.remove("in");
    finaleEl.classList.add("hidden");
    etaEl.classList.add("hidden");
    breathing.classList.remove("hidden");
  }

  return { update, reset, finale };
})();
