/*
 * Browser reading mode inspired by Madhusudan Kulkarni's 0BSD Obsidian Speed
 * Reader and Joshua Adesida's modified settings and centered-word layout.
 * https://github.com/madhusudan-kulkarni/obsidian-speed-reader
 */
(() => {
  const get = (id) => document.getElementById(id);
  const essay = get("essay-text");
  const dialog = get("speed-reader");
  const open = get("open-reader");
  if (!essay || !dialog || !open || typeof dialog.showModal !== "function") return;

  const playButton = get("reader-play");
  const timeline = get("reader-position");
  const speed = get("reader-wpm");
  const size = get("reader-size");
  const chunkSize = get("reader-chunk");
  const pauses = get("reader-pauses");
  const sectionPicker = get("reader-section-picker");
  const wordLine = get("word-line");
  const before = get("word-before");
  const pivot = get("word-pivot");
  const after = get("word-after");
  const count = get("reader-count");
  const status = get("reader-status");
  const words = [];
  const sections = [0];

  for (const block of essay.querySelectorAll("h2, h3, p, li")) {
    if (block.matches("p") && block.closest("li")) continue;
    const tokens = block.textContent.match(/\S+/gu);
    if (!tokens) continue;
    if (block.matches("h2, h3")) {
      sections.push(words.length);
      sectionPicker.add(new Option(block.textContent, String(words.length)));
    }
    tokens.forEach((text, index) => {
      words.push({ text, endsBlock: index === tokens.length - 1 });
    });
  }

  if (!words.length) return;

  const last = words.length - 1;
  let position = 0;
  let timer = null;
  let playing = false;
  let finished = false;
  let ramp = 0;
  let wpm = Number(speed.value);
  timeline.max = String(last);
  open.hidden = false;

  function setAnnouncement(label) {
    status.textContent = label + " " + (position + 1) + " of " + words.length + " words.";
  }

  function shownWords() {
    const end = Math.min(words.length, position + Number(chunkSize.value));
    const visible = [];
    for (let index = position; index < end; index += 1) {
      const token = words[index];
      visible.push(token);
      if (token.endsBlock) break;
    }
    return visible;
  }

  function fitWord() {
    if (!dialog.open) return;
    const base = Number(size.value);
    wordLine.classList.remove("unpinned");
    wordLine.style.fontSize = base + "px";
    const side = Math.max(before.getBoundingClientRect().width, after.getBoundingClientRect().width);
    const required = 2 * side + pivot.getBoundingClientRect().width;
    const fitted = base * Math.min(1, wordLine.clientWidth / Math.max(1, required));
    wordLine.classList.toggle("unpinned", fitted < 20);
    wordLine.style.fontSize = Math.max(20, Math.floor(fitted)) + "px";
  }

  function draw() {
    const visible = shownWords();
    const letters = Array.from(visible[0].text);
    const lead = letters.findIndex((char) => /[\p{L}\p{N}]/u.test(char));
    const first = Math.max(0, lead);
    const length = letters.filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
    const anchor = Math.min(letters.length - 1, first + Math.max(0, Math.floor((length - 1) * 0.35)));
    before.textContent = letters.slice(0, anchor).join("");
    pivot.textContent = letters[anchor];
    const suffix = letters.slice(anchor + 1).join("");
    after.textContent = [suffix, ...visible.slice(1).map((token) => token.text)].join(" ");
    fitWord();
    timeline.value = String(position);
    const text = (position + 1) + " / " + words.length;
    count.textContent = text;
    timeline.setAttribute("aria-valuetext", (position + 1) + " of " + words.length + " words");
    let section = sections.length - 1;
    while (sections[section] > position) section -= 1;
    sectionPicker.value = String(sections[section]);
    playButton.textContent = playing ? "Pause" : finished ? "Play from start" : "Play";
  }

  function pause({ refresh = true } = {}) {
    window.clearTimeout(timer);
    timer = null;
    playing = false;
    if (refresh && dialog.open) draw();
  }

  function schedule() {
    const visible = shownWords();
    const finalWord = visible.at(-1);
    let delay = 60000 * visible.length / wpm;
    if (pauses.checked) {
      if (finalWord.endsBlock || /[.!?]["'’”)\]]*$/u.test(finalWord.text)) delay *= 1.7;
      else if (/[,;:]["'’”)\]]*$/u.test(finalWord.text)) delay *= 1.35;
      else if (visible.some(({ text }) => text.length >= 10 || /\d/u.test(text))) delay *= 1.18;
    }
    delay *= [1.5, 1.25, 1.1][ramp] ?? 1;
    ramp += 1;

    timer = window.setTimeout(() => {
      const next = position + visible.length;
      if (next > last) {
        position = last;
        finished = true;
        pause();
        setAnnouncement("Finished.");
      } else {
        position = next;
        draw();
        schedule();
      }
    }, delay);
  }

  function togglePlayback() {
    if (playing) {
      pause();
      setAnnouncement("Paused.");
      return;
    }
    if (finished) position = 0;
    finished = false;
    playing = true;
    ramp = 0;
    draw();
    schedule();
    setAnnouncement("Playing.");
  }

  function seek(index) {
    pause({ refresh: false });
    position = Math.min(last, Math.max(0, index));
    finished = false;
    draw();
    setAnnouncement("Paused.");
  }

  function setSpeed(value) {
    const adjusted = Math.round(value / 25) * 25;
    wpm = Math.min(Number(speed.max), Math.max(Number(speed.min), adjusted));
    speed.value = String(wpm);
    if (playing) {
      window.clearTimeout(timer);
      schedule();
    }
  }

  open.addEventListener("click", () => {
    dialog.showModal();
    draw();
  });
  get("reader-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    pause();
    open.focus();
  });
  playButton.addEventListener("click", togglePlayback);
  get("reader-back").addEventListener("click", () => seek(position - 10));
  get("reader-forward").addEventListener("click", () => seek(position + 10));
  timeline.addEventListener("input", () => seek(Number(timeline.value)));
  sectionPicker.addEventListener("change", () => seek(Number(sectionPicker.value)));
  speed.addEventListener("change", () => setSpeed(speed.valueAsNumber || wpm));
  size.addEventListener("input", fitWord);
  chunkSize.addEventListener("change", () => pause());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("blur", () => pause());
  window.addEventListener("resize", fitWord);

  dialog.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, select")) return;
    const steps = { ArrowLeft: -10, ArrowRight: 10 };
    if (event.key in steps) {
      event.preventDefault();
      seek(position + steps[event.key]);
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      seek(0);
    }
  });
})();
