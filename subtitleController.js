// subtitleController.js
//
// Handles local subtitle files, entirely client-side — no server
// involvement, since each partner loads their own copy just like they
// load their own video file.
//
// Formats supported: .srt, .vtt, .ass/.ssa (dialogue + basic inline
// styling tags stripped), .sub (MicroDVD, frame-based), .sbv (YouTube).
// Not covered, honestly: image-based subtitle formats like .sub/.idx
// (VobSub) or PGS — these are bitmap overlays, not text, and rendering
// them would need actual image decoding rather than a text parser, a
// meaningfully different feature. TTML/DFXP (XML-based) is also not
// included yet; flag if you hit one and it's worth adding.

class SubtitleController {
  constructor(videoEl, overlayEl) {
    this.video = videoEl;
    this.overlay = overlayEl;
    this.cues = [];          // [{ start, end, text }] in seconds
    this.delayMs = 0;        // positive = subtitles appear later
    this.fontSizePx = 22;
    this.enabled = true;

    this.video.addEventListener('timeupdate', () => this._render());
    this._applyFontSize();
  }

  /** Load a local subtitle File object, auto-detecting format by extension. */
  async loadFile(file) {
    const text = await file.text();
    const name = file.name.toLowerCase();

    if (name.endsWith('.vtt') || text.trim().startsWith('WEBVTT')) {
      this.cues = parseVTT(text);
    } else if (name.endsWith('.ass') || name.endsWith('.ssa')) {
      this.cues = parseASS(text);
    } else if (name.endsWith('.sbv')) {
      this.cues = parseSBV(text);
    } else if (name.endsWith('.sub')) {
      this.cues = parseMicroDVD(text);
    } else {
      // Default to SRT — the most common extension-less/ambiguous case.
      this.cues = parseSRT(text);
    }

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

// --- Shared helpers ----------------------------------------------------

function timeToSeconds(h, m, s, frac) {
  // frac may be milliseconds (3 digits) or centiseconds (2 digits, ASS).
  const fracSeconds = frac.length === 2 ? Number(frac) / 100 : Number(frac) / 1000;
  return (+h) * 3600 + (+m) * 60 + (+s) + fracSeconds;
}

/** Strip {\...} override tags and convert \N / \n line breaks to real ones. */
function cleanInlineFormatting(text) {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/<[^>]+>/g, ''); // also strip basic HTML-ish tags some SRTs use
}

// --- Parsers -------------------------------------------------------------

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
      text: cleanInlineFormatting(textLines.join('\n')),
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
      text: cleanInlineFormatting(textLines.join('\n')),
    });
  }

  return cues;
}

/**
 * ASS/SSA: lines look like
 * Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello {\i1}world{\i0}
 * Only the [Events] section's Dialogue lines matter for playback; styling
 * ([V4+ Styles]) is intentionally ignored — we render plain text only.
 */
function parseASS(text) {
  const cues = [];
  const lines = text.replace(/\r/g, '').split('\n');

  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;

    // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    // Split on commas but only up to the 9th one — the text field itself
    // may contain commas and shouldn't be split further.
    const parts = line.slice('Dialogue:'.length).split(',');
    if (parts.length < 10) continue;

    const start = parts[1].trim();
    const end = parts[2].trim();
    const textField = parts.slice(9).join(',').trim();

    const startMatch = start.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    const endMatch = end.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    if (!startMatch || !endMatch) continue;

    cues.push({
      start: timeToSeconds(startMatch[1], startMatch[2], startMatch[3], startMatch[4]),
      end: timeToSeconds(endMatch[1], endMatch[2], endMatch[3], endMatch[4]),
      text: cleanInlineFormatting(textField),
    });
  }

  return cues;
}

/**
 * MicroDVD .sub: frame-based, e.g. {0}{50}Text|Second line
 * Frame numbers need a frame rate to convert to seconds. We don't know
 * the actual video's fps from the subtitle file alone, so this assumes
 * 25fps (a common default) — timing may drift on videos shot at a
 * different frame rate. Flagged here rather than silently guessing.
 */
function parseMicroDVD(text) {
  const ASSUMED_FPS = 25;
  const cues = [];
  const lines = text.replace(/\r/g, '').split('\n');

  for (const line of lines) {
    const match = line.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
    if (!match) continue;

    const [, startFrame, endFrame, rawText] = match;
    cues.push({
      start: Number(startFrame) / ASSUMED_FPS,
      end: Number(endFrame) / ASSUMED_FPS,
      text: cleanInlineFormatting(rawText.replace(/\|/g, '\n')),
    });
  }

  return cues;
}

/**
 * SBV (YouTube captions):
 * 0:00:01.000,0:00:04.000
 * Text here
 */
function parseSBV(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines[0];
    if (!timeLine || !timeLine.includes(',')) continue;

    const match = timeLine.match(
      /(\d+):(\d{2}):(\d{2})\.(\d{3}),(\d+):(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!match) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    cues.push({
      start: timeToSeconds(h1, m1, s1, ms1),
      end: timeToSeconds(h2, m2, s2, ms2),
      text: cleanInlineFormatting(lines.slice(1).join('\n')),
    });
  }

  return cues;
}
