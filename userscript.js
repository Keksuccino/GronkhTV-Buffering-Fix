// ==UserScript==
// @name         GRONKH.TV - Unstick Stalled HTML5 Video (audio-buffering aware)
// @match        https://gronkh.tv/*
// @grant        none
// ==/UserScript==
(function () {
  const CHECK_MS = 250;      // watchdog cadence
  const STALL_MS = 900;      // how long with no progress counts as a stall
  const NUDGE_SEEK = 0.05;   // seconds to nudge across tiny gaps
  const EDGE_SLOP = 0.12;    // how close to the end of a range we consider "edge"
  const RATE_PULSE = 1.12;   // short playbackRate pulse to kick audio
  const RATE_PULSE_MS = 220;

  function withinBuffered(v, t) {
    for (let i = 0; i < v.buffered.length; i++) {
      const start = v.buffered.start(i), end = v.buffered.end(i);
      if (t >= start && t <= end) return {i, start, end};
    }
    return null;
  }

  function nextBufferedStart(v, t) {
    // first range that starts after t
    let best = null;
    for (let i = 0; i < v.buffered.length; i++) {
      const s = v.buffered.start(i);
      if (s > t && (best === null || s < best)) best = s;
    }
    return best;
  }

  function attach(v) {
    if (v.__unstickerAttached) return;
    v.__unstickerAttached = true;

    let lastT = 0, lastWall = performance.now(), recovering = false;

    async function audioPulse() {
      // brief playbackRate pulse + micro-seek tends to re-prime audio
      const orig = v.playbackRate || 1;
      try { v.playbackRate = RATE_PULSE; } catch {}
      try { v.currentTime = v.currentTime + 0.001; } catch {}
      try { await v.play?.(); } catch {}
      setTimeout(() => { try { v.playbackRate = orig; } catch {} }, RATE_PULSE_MS);
    }

    function smartNudge(reason) {
      if (recovering) return;
      recovering = true;

      try {
        // 1) Range-aware seek: if we’re at the edge of a range, hop over it
        const ct = v.currentTime;
        const inRange = withinBuffered(v, ct);

        if (!inRange) {
          const ns = nextBufferedStart(v, ct);
          if (ns != null) {
            v.currentTime = ns + 0.02;
          } else {
            v.currentTime = Math.min((v.duration || ct) - 0.01, ct + NUDGE_SEEK);
          }
        } else {
          const { end } = inRange;
          if (end - ct <= EDGE_SLOP) {
            // At end of a tiny range → hop just past it
            v.currentTime = Math.min((v.duration || end) - 0.01, end + 0.02);
          } else {
            // Looks buffered but still stuck → audio pulse
            audioPulse();
          }
        }

        // Ensure we’re actually playing afterwards
        v.play?.().catch(() => {});
      } finally {
        setTimeout(() => { recovering = false; }, 500);
      }
    }

    // Event-based kicks when Chrome declares trouble
    ['stalled','waiting','suspend','emptied','error'].forEach(ev =>
      v.addEventListener(ev, () => smartNudge(ev), { passive: true })
    );

    // Watchdog: time not advancing while not paused and not seeking
    setInterval(() => {
      if (v.paused || v.seeking) { lastT = v.currentTime; lastWall = performance.now(); return; }
      const ct = v.currentTime;
      if (ct !== lastT) { lastT = ct; lastWall = performance.now(); return; }
      if (performance.now() - lastWall > STALL_MS) smartNudge('watchdog');
    }, CHECK_MS);
  }

  // Attach to any videos on the page (player swaps sources dynamically)
  const scan = () => document.querySelectorAll('video').forEach(attach);
  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { subtree: true, childList: true });
  scan();
})();
