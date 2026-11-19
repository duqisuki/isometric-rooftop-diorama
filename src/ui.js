(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { LIST, TOUR_DURATION, formatTime } = Diorama.Scenarios;
  const { clamp } = Diorama.Palette;

  function createUI(controller) {
    const elTitle = document.getElementById('scene-title');
    const elTrigger = document.getElementById('scene-trigger');
    const elMenu = document.getElementById('scene-menu');
    const elSegments = document.getElementById('scene-segments');
    const elBtnPlay = document.getElementById('btn-play');
    const elScrubber = document.getElementById('scrubber');
    const elTrack = document.getElementById('scrubber-track');
    const elFill = document.getElementById('scrubber-fill');
    const elTicks = document.getElementById('scrubber-ticks');
    const elThumb = document.getElementById('scrubber-thumb');
    const elTime = document.getElementById('time-readout');
    const elBtnTour = document.getElementById('btn-tour');
    const elBtnAudio = document.getElementById('btn-audio');
    const elToast = document.getElementById('interact-toast');

    let menuOpen = false;
    let dragging = false;
    let toastTimer = null;

    // ── Build Dropdown Options & 5 Progress Segments ────────────────
    const optionEls = [];
    const segmentFills = [];

    LIST.forEach((sc, idx) => {
      // Dropdown item
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'scene-option';
      opt.setAttribute('role', 'option');
      opt.innerHTML =
        `<span class="scene-option-left">` +
        `<span class="scene-key">${sc.key}</span>` +
        `<span>${sc.name}</span>` +
        `</span>` +
        `<span class="scene-option-time">${formatTime(sc.defaultHour)}</span>`;
      opt.addEventListener('click', () => {
        controller.selectScenario(idx, true);
        setMenuOpen(false);
      });
      elMenu.appendChild(opt);
      optionEls.push(opt);

      // Progress segment button
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'scene-segment';
      seg.setAttribute('role', 'tab');
      seg.title = `${sc.key}. ${sc.name} (${formatTime(sc.defaultHour)})`;
      seg.setAttribute('aria-label', `${sc.name}`);
      const track = document.createElement('span');
      track.className = 'scene-segment-track';
      const fill = document.createElement('span');
      fill.className = 'scene-segment-fill';
      track.appendChild(fill);
      seg.appendChild(track);
      seg.addEventListener('click', () => {
        controller.selectScenario(idx, true);
      });
      elSegments.appendChild(seg);
      segmentFills.push(fill);
    });

    // Subtle 24-hour tick marks on scrubber track (06:00, 12:00, 18:00 + scenario markers)
    [0.2, 0.4, 0.6, 0.8].forEach((pos) => {
      const tk = document.createElement('span');
      tk.className = 'scrubber-tick';
      tk.style.left = (pos * 100) + '%';
      elTicks.appendChild(tk);
    });

    function setMenuOpen(open) {
      menuOpen = open;
      elMenu.hidden = !open;
      elTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    elTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenuOpen(!menuOpen);
    });

    document.addEventListener('click', (e) => {
      if (menuOpen && !elMenu.contains(e.target) && !elTrigger.contains(e.target)) {
        setMenuOpen(false);
      }
    });

    // ── Play / Pause ────────────────────────────────────────────────
    elBtnPlay.addEventListener('click', () => {
      controller.togglePlay();
    });

    // ── 5x10s Tour Mode Toggle ──────────────────────────────────────
    elBtnTour.addEventListener('click', () => {
      controller.toggleTourMode();
    });

    // ── Audio Toggle ────────────────────────────────────────────────
    elBtnAudio.addEventListener('click', () => {
      controller.toggleAudio();
    });

    // ── Draggable 24h Time Scrubber ─────────────────────────────────
    function scrubFromClientX(clientX) {
      const rect = elTrack.getBoundingClientRect();
      const frac = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.9993);
      controller.setTimeOfDay(frac * 24);
    }

    elScrubber.addEventListener('pointerdown', (e) => {
      dragging = true;
      elScrubber.classList.add('dragging');
      elScrubber.setPointerCapture(e.pointerId);
      scrubFromClientX(e.clientX);
    });

    elScrubber.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      scrubFromClientX(e.clientX);
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      elScrubber.classList.remove('dragging');
      if (e && elScrubber.hasPointerCapture && elScrubber.hasPointerCapture(e.pointerId)) {
        elScrubber.releasePointerCapture(e.pointerId);
      }
    };
    elScrubber.addEventListener('pointerup', endDrag);
    elScrubber.addEventListener('pointercancel', endDrag);

    // ── Keyboard Shortcuts (1–5, Space, M, Arrows, Esc) ─────────────
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key >= '1' && e.key <= '5') {
        const idx = parseInt(e.key, 10) - 1;
        controller.selectScenario(idx, true);
        setMenuOpen(false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        controller.togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        controller.toggleAudio();
      } else if (e.key === 'z' || e.key === 'Z') {
        if (controller.spawnWave) controller.spawnWave();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        controller.nudgeTime(20 / 60);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        controller.nudgeTime(-20 / 60);
      } else if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
      }
    });

    function showToast(msg) {
      if (!msg) return;
      elToast.textContent = msg;
      elToast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        elToast.classList.remove('visible');
      }, 1550);
    }

    function sync(state, atmo) {
      // Scene title & dropdown active indicator
      if (elTitle.textContent !== state.scenario.name) {
        elTitle.textContent = state.scenario.name;
      }
      for (let i = 0; i < optionEls.length; i++) {
        optionEls[i].classList.toggle('active', i === state.scenarioIndex);
      }

      // 5 segmented progress bars
      for (let i = 0; i < segmentFills.length; i++) {
        let pct = 0;
        if (i < state.scenarioIndex) {
          pct = 100;
        } else if (i === state.scenarioIndex) {
          pct = state.tourMode
            ? clamp((state.tourElapsed / TOUR_DURATION) * 100, 4, 100)
            : 100;
        }
        segmentFills[i].style.width = pct.toFixed(1) + '%';
      }

      // Scrubber position & live clock
      const frac = (((state.hours % 24) + 24) % 24) / 24;
      const pctStr = (frac * 100).toFixed(2) + '%';
      elFill.style.width = pctStr;
      elThumb.style.left = pctStr;
      const formatted = formatTime(state.hours);
      if (elTime.textContent !== formatted) {
        elTime.textContent = formatted;
        elScrubber.setAttribute('aria-valuenow', String(Math.round(frac * 1440)));
        elScrubber.setAttribute('aria-valuetext', formatted);
      }

      // Play/pause & mode buttons
      elBtnPlay.classList.toggle('paused', state.paused);
      elBtnPlay.setAttribute('aria-label', state.paused ? 'Resume simulation' : 'Pause simulation');

      elBtnTour.textContent = state.tourMode ? '5×10s' : 'Loop';
      elBtnTour.setAttribute('aria-pressed', state.tourMode ? 'true' : 'false');

      elBtnAudio.setAttribute('aria-pressed', state.audioEnabled ? 'true' : 'false');

      // Seamless studio background & light/dark UI theme sync
      if (atmo) {
        document.documentElement.style.setProperty('--bg', atmo.bgHex);
        document.body.dataset.theme = atmo.isDarkTheme ? 'dark' : 'light';
      }
    }

    return {
      sync,
      showToast,
    };
  }

  Diorama.UI = { createUI };
})(window);
