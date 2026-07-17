// subtitleController.js
//
// Handles local subtitle files (.srt and .vtt), entirely client-side —
// no server involvement, since each partner loads their own copy just
// like they load their own video file. Covers the core of what MX
// Player's subtitle menu offers: load, delay adjustment, font size,
// on/off toggle. (Things like per-cue color/positioning or embedded
// subtitle-track extraction from the video container aren't in this
// first pass — flagging that so it's a known gap, not a silent one.)

class SubtitleController {
  constructor(videoEl, overlayEl) {
    this.video = videoEl;
    this.overlay = overlayEl;
    this.cues = [];          // [{ start, end, text }] in seconds
    this.delayMs = 0;        // positive = subtitles appear later
    this.fontSizePx = 22;
    this.enabled = true;
    this.currentCueIndex = -1;

    this.video.addEventListener('timeupdate', () => this._render());
    this._applyFontSize();
  }

  /** Load a local .srt or .vtt File object. */
  async loadFile(file) {
    const text = await file.text();
    const isVtt = /\.vtt$/i.test(file.name) || text.trim().startsWith('WEBVTT');
    this.cues = isVtt ? parseVTT(text) : parseSRT(text);
    this.currentCueIndex = -1;
    this.enabled = true;
    this.overlay.hidden = false;
  }

  setDelay(ms) {
    this.delayMs = ms;
  }

  adjustDelay(deltaMs) {
    this.delayMs += deltaMs;
  }

  setFontSize(px) {
    this.fontSizePx = Math.max(12, Math.min(48, px));
    this._applyFontSize();
  }

  toggle(enabled) {
    this.enabled = enabled;
    if (!enabled) this.overlay.textContent = '';
  }

  _applyFontSize() {
    this.overlay.style.fontSize = `${this.fontSizePx}px`;
  }

  _render() {
    if (!this.enabled || this.cues.length === 0) return;

    const adjustedTime = this.video.currentTime - this.delayMs / 1000;
    const active = this.cues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);

    this.overlay.textContent = active ? active.text : '';
  }
}

// --- Parsers ---------------------------------------------------------------

function timeToSeconds(h, m, s, ms) {
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

function parseSRT(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;

    const match = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!match) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);

    cues.push({
      start: timeToSeconds(h1, m1, s1, ms1),
      end: timeToSeconds(h2, m2, s2, ms2),
      text: textLines.join('\n'),
    });
  }

  return cues;
}

function parseVTT(text) {
  const blocks = text.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '').split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;

    const match = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!match) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);

    cues.push({
      start: timeToSeconds(h1, m1, s1, ms1),
      end: timeToSeconds(h2, m2, s2, ms2),
      text: textLines.join('\n'),
    });
  }

  return cues;
}
