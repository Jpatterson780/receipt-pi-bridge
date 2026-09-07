(() => {
  const $ = id => document.getElementById(id);
  const state = {
    mode: 'lines',
    bridgeUrl: window.location.origin,
    canAttemptPrint: false,
    printInProgress: false,
    logoData: null,
    // Populated from /api/health — null until the first successful check.
    serverMaxPaperInches: null
  };
  const connectionForm = $('connection-form');
  const bridgeUrl = $('bridge-url');
  const form = $('receipt-form');
  const text = $('receipt-text');
  const lineNumbers = $('line-numbers');
  const copies = $('copies');
  const cut = $('cut');
  const compressed = $('compressed');
  const preLines = $('pre-lines');
  const postLines = $('post-lines');
  const maxPaper = $('max-paper');
  const message = $('message');
  const LAST_PRINT_KEY = 'ncr7198.lastPrint';
  const preferenceIds = ['pre-lines', 'post-lines', 'compressed', 'cut', 'copies', 'logo-position'];
  const textLinesPerInch = 7.40;
  const printerDotsPerInch = 203;
  const cutterAllowanceInches = 0.70;
  const drafts = {
    lines: text.value,
    content: 'Thanks for visiting Northstar Market. This Content mode sample is written as a paragraph so the bridge can automatically wrap it to the selected receipt width. Edit or replace this text, then preview the result before printing.'
  };

  function normalizeBridgeUrl(value) {
    const raw = value.trim();
    if (!raw) throw new Error('Enter the Pi bridge address and port.');
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Bridge URL must use http:// or https://.');
    return url.origin;
  }

  function loadBridgeUrl() {
    try { state.bridgeUrl = normalizeBridgeUrl(localStorage.getItem('ncr7198.bridgeUrl') || window.location.origin); }
    catch { state.bridgeUrl = window.location.origin; }
    bridgeUrl.value = state.bridgeUrl;
  }

  function apiUrl(path) {
    return `${state.bridgeUrl}${path}`;
  }

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem('ncr7198.preferences') || '{}');
      preferenceIds.forEach(id => {
        if (!(id in saved)) return;
        const control = $(id);
        if (control.type === 'checkbox') control.checked = Boolean(saved[id]);
        else control.value = saved[id];
      });
    } catch { /* Ignore damaged browser-local settings. */ }
  }

  function savePreferences() {
    const saved = {};
    preferenceIds.forEach(id => {
      const control = $(id);
      saved[id] = control.type === 'checkbox' ? control.checked : control.value;
    });
    localStorage.setItem('ncr7198.preferences', JSON.stringify(saved));
  }

  function setMode(mode) {
    if (mode !== state.mode) {
      drafts[state.mode] = text.value;
      state.mode = mode;
      text.value = drafts[mode];
      text.scrollTop = 0;
    }
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('mode-help').textContent = mode === 'lines'
      ? 'Each textarea row becomes one literal width-limited line. Spaces and blank lines are preserved.'
      : 'Content is word-wrapped for print. Explicit line breaks are preserved, with no editor width limit.';
    syncOptions();
  }

  function syncLineNumbers() {
    const count = text.value.split('\n').length;
    lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
    lineNumbers.scrollTop = text.scrollTop;
  }

  function syncOptions() {
    const multiple = Number(copies.value) > 1;
    if (multiple) cut.checked = true;
    cut.disabled = multiple;
    $('cut-note').classList.toggle('hidden', !multiple);
    const width = compressed.checked ? 56 : 44;
    $('column-rule').textContent = state.mode === 'content' ? `${width} characters wide` : `${width}-character maximum`;
    $('preview-width').textContent = `${width} characters wide`;
    $('character-count').textContent = `${text.value.length.toLocaleString()} / 16,384`;
    syncLineNumbers();
    updateLiveEstimate();
  }

  // Estimated paper length as you type, well before Preview/Print would
  // actually confirm it — catches an over-length receipt at the moment
  // it happens instead of as a surprise rejection after filling out the
  // whole form. Exact for Lines mode (wrap is always 'none' there, so
  // each row is already exactly one physical line — see
  // ReceiptRenderer.RenderLiteralLines on the server); an approximation
  // for Content mode, which the bridge word-wraps server-side. Doesn't
  // account for a logo's raster bands (unlike estimatePaperInches(),
  // used after a real Preview) since that needs decoding the image — the
  // "~" prefix already signals this is an estimate, and Preview/Print
  // remain the actual source of truth either way.
  function estimateLiveInches() {
    const width = compressed.checked ? 56 : 44;
    let contentRows;
    if (state.mode === 'lines') {
      contentRows = text.value.split('\n').length;
    } else {
      contentRows = text.value.split('\n').reduce((total, line) => {
        if (line.length === 0) return total + 1;
        let rows = 1, current = 0;
        for (const word of line.split(' ')) {
          const candidate = current === 0 ? word.length : current + 1 + word.length;
          if (candidate > width) { rows++; current = word.length; }
          else { current = candidate; }
        }
        return total + rows;
      }, 0);
    }
    const textRows = (Number(preLines.value) || 0) + contentRows + (Number(postLines.value) || 0);
    const effectiveCut = cut.checked || Number(copies.value) > 1;
    const perCopy = textRows / textLinesPerInch + (effectiveCut ? cutterAllowanceInches : 0);
    return perCopy * (Number(copies.value) || 1);
  }

  function updateLiveEstimate() {
    const el = $('paper-estimate');
    const inches = estimateLiveInches();
    el.textContent = `~${inches.toFixed(2)} in`;
    const override = maxPaper.value.trim();
    const effectiveMax = override !== '' ? Number(override) : state.serverMaxPaperInches;
    const overLimit = effectiveMax !== null && effectiveMax > 0 && inches > effectiveMax;
    el.classList.toggle('over-limit', overLimit);
  }

  function payload() {
    const value = text.value.replace(/\r\n/g, '\n');
    return {
      printId: $('print-id').value.trim() || null,
      prePrintLines: Number($('pre-lines').value),
      lines: state.mode === 'lines' ? value.split('\n') : null,
      content: state.mode === 'content' ? value : null,
      postPrintLines: Number($('post-lines').value),
      wrap: state.mode === 'content' ? 'word' : 'none',
      compressed: compressed.checked,
      cut: cut.checked,
      copies: Number(copies.value),
      logo: state.logoData,
      logoPosition: $('logo-position').value,
      maxPaperLengthInches: $('max-paper').value.trim() ? Number($('max-paper').value) : null
    };
  }

  // Reflects the bridge's actual currently-configured default rather than
  // a guess baked into this page — that default is a live setting
  // (Bridge__MaxPaperLengthInches), not something this static page can
  // know on its own. `maxInches` is undefined/null while the bridge is
  // unreachable or hasn't reported one yet.
  function updatePaperLimit(maxInches) {
    state.serverMaxPaperInches = maxInches === undefined ? null : maxInches;
    updateLiveEstimate();
    const input = $('max-paper');
    const help = $('paper-limit-help');
    if (maxInches === undefined || maxInches === null) {
      input.placeholder = 'server default';
      help.textContent = 'Maximum estimated paper use is set on the bridge, including feeds, logos, cuts, and copies. Leave "Max paper" blank to use it, or set a one-off value for just this print.';
    } else if (maxInches > 0) {
      input.placeholder = `server default: ${maxInches}"`;
      help.textContent = `Maximum estimated paper use is ${maxInches} inches by default, including feeds, logos, cuts, and copies. Leave "Max paper" blank to use it, or set a one-off value for just this print (0 removes the limit for that print).`;
    } else {
      input.placeholder = 'server default: no limit';
      help.textContent = 'No maximum paper length is currently configured on the bridge. Set "Max paper" to cap just this one print.';
    }
  }

  function formatSeconds(ms) {
    const seconds = ms / 1000;
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  }

  function updateDispatcher(info) {
    const el = $('dispatcher');
    if (info === undefined) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (!info) {
      el.textContent = 'Dispatcher not reporting';
      el.className = 'status dispatcher warn';
    } else if (info.stale) {
      el.textContent = `Dispatcher stale · last seen ${info.reportAgeSeconds}s ago`;
      el.className = 'status dispatcher warn';
    } else {
      const mode = info.mode.charAt(0).toUpperCase() + info.mode.slice(1);
      el.textContent = `Dispatcher ${mode} · Polling Every ${formatSeconds(info.intervalMs)}s`;
      el.className = `status dispatcher ${info.mode}`;
    }
  }

  // How many jobs PrintCoordinator is currently holding (in flight or
  // waiting behind MaxOutstandingJobs) — otherwise invisible from this
  // page; a person watching it would have no way to tell "just printed"
  // from "backed up" without this. `depth`/`max` are undefined while the
  // bridge is unreachable.
  function updateQueueDepth(depth, max) {
    const el = $('queue');
    if (depth === undefined || max === undefined) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = `Queue ${depth}/${max}`;
    el.className = depth >= max ? 'status warn' : 'status';
  }

  // Persists across reloads (localStorage, same "this browser only" scope
  // as the saved Bridge URL/preferences) so "did that last print actually
  // go through" is answerable by glancing at the page after walking away,
  // not just from the transient message shown at the moment it happened.
  function renderLastPrint(entry) {
    const el = $('last-print');
    if (!entry) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const time = new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (entry.ok) {
      el.textContent = `Last print: ${time} · ${entry.status}${entry.printId ? ` · ${entry.printId}` : ''}`;
      el.classList.remove('error');
    } else {
      el.textContent = `Last print: ${time} · failed · ${entry.message}`;
      el.classList.add('error');
    }
  }

  function recordLastPrint(entry) {
    try { localStorage.setItem(LAST_PRINT_KEY, JSON.stringify(entry)); } catch { /* private browsing, etc. */ }
    renderLastPrint(entry);
  }

  function loadLastPrint() {
    try {
      const raw = localStorage.getItem(LAST_PRINT_KEY);
      renderLastPrint(raw ? JSON.parse(raw) : null);
    } catch { renderLastPrint(null); }
  }

  function showMessage(value, kind) {
    message.textContent = value;
    message.className = `message ${kind}`;
  }

  function setPrintAvailability(available, reason = '') {
    state.canAttemptPrint = available;
    const button = $('print-button');
    button.disabled = !available || state.printInProgress;
    button.title = available ? '' : reason;
  }

  function clearReceiptPreview() {
    $('preview-card').classList.add('hidden');
    $('preview').replaceChildren();
    $('paper-length').textContent = '';
  }

  function clearJsonPreview() {
    $('json-preview-card').classList.add('hidden');
    $('json-preview').textContent = '';
    $('copy-json-button').disabled = true;
    $('copy-json-button').textContent = 'Copy JSON';
  }

  function estimatePaperInches(lines) {
    const printed = lines.filter(line => line !== '[CUT]');
    const cuts = lines.filter(line => line === '[CUT]').length;
    const logoBands = printed.reduce((total, line) => {
      const match = /^\[LOGO: \d+x(\d+)\]$/.exec(line);
      return total + (match ? Math.ceil(Number(match[1]) / 24) : 0);
    }, 0);
    return (printed.length - logoBands) / textLinesPerInch +
      logoBands * 24 / printerDotsPerInch + cuts * cutterAllowanceInches;
  }

  async function writeClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('The browser did not allow clipboard access.');
  }

  async function post(path) {
    const response = await fetch(apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function run(button, action) {
    if (!form.reportValidity()) return;
    message.classList.add('hidden');
    if (button.id === 'print-button') state.printInProgress = true;
    button.disabled = true;
    try { await action(); }
    catch (error) { showMessage(error.message, 'error'); }
    finally {
      if (button.id === 'print-button') state.printInProgress = false;
      button.disabled = button.id === 'print-button' ? !state.canAttemptPrint : false;
    }
  }

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  [copies, compressed, text, cut, preLines, postLines, maxPaper].forEach(control => control.addEventListener('input', syncOptions));
  text.addEventListener('scroll', syncLineNumbers);
  preferenceIds.forEach(id => $(id).addEventListener('change', savePreferences));
  $('logo').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    state.logoData = null;
    input.setCustomValidity('');
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      input.setCustomValidity('Logo images cannot exceed 8 MB.');
      input.reportValidity();
      return;
    }

    input.setCustomValidity('Reading logo image...');
    try {
      state.logoData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The logo image could not be read.'));
        reader.readAsDataURL(file);
      });
      input.setCustomValidity('');
    } catch (error) {
      input.setCustomValidity(error.message);
      input.reportValidity();
    }
  });

  connectionForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      state.bridgeUrl = normalizeBridgeUrl(bridgeUrl.value);
      bridgeUrl.value = state.bridgeUrl;
      localStorage.setItem('ncr7198.bridgeUrl', state.bridgeUrl);
      setPrintAvailability(false, 'Checking the Pi bridge.');
      await checkHealth();
    } catch (error) {
      bridgeUrl.setCustomValidity(error.message);
      bridgeUrl.reportValidity();
    }
  });
  bridgeUrl.addEventListener('input', () => bridgeUrl.setCustomValidity(''));

  $('preview-button').addEventListener('click', event => {
    clearReceiptPreview();
    run(event.currentTarget, async () => {
      const result = await post('/api/preview');
      const lines = result.lines;
      const preview = $('preview');
      preview.replaceChildren(...lines.map(line => {
        const row = document.createElement('div');
        if (line === '[CUT]') {
          row.className = 'preview-line cut';
          row.textContent = line;
          return row;
        }
        if (line.startsWith('[LOGO:')) {
          row.className = 'preview-line logo';
          // result.logo is the actual dithered 1-bit image — the exact
          // bytes the printer would receive, not a re-derived guess — so
          // this shows what a logo will really look like on thermal paper
          // instead of just its dimensions. Falls back to the dimensions
          // text on the off chance it's missing.
          if (result.logo) {
            const img = document.createElement('img');
            img.src = result.logo;
            img.alt = 'Logo preview (dithered for thermal printing)';
            img.className = 'preview-logo-img';
            row.appendChild(img);
          } else {
            row.textContent = line;
          }
          return row;
        }
        row.className = 'preview-line';
        row.textContent = line;
        return row;
      }));
      $('paper-length').textContent = `Estimated paper: ~${estimatePaperInches(lines).toFixed(2)} in`;
      $('preview-card').classList.remove('hidden');
      $('preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('json-preview-button').addEventListener('click', event => {
    clearJsonPreview();
    run(event.currentTarget, async () => {
      await post('/api/preview');
      $('json-preview').textContent = JSON.stringify(payload(), null, 2);
      $('copy-json-button').disabled = false;
      $('json-preview-card').classList.remove('hidden');
      $('json-preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('close-preview-button').addEventListener('click', clearReceiptPreview);
  $('close-json-preview-button').addEventListener('click', clearJsonPreview);

  $('copy-json-button').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await writeClipboard($('json-preview').textContent);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy JSON'; }, 1500);
    } catch (error) { showMessage(error.message, 'error'); }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    run($('print-button'), async () => {
      try {
        const result = await post('/api/print');
        const forced = result.cutForced ? ' Cut was forced because copies is greater than one.' : '';
        showMessage(`Print ${result.status}: ${result.copies} ${result.copies === 1 ? 'copy' : 'copies'} submitted.${forced}`, 'success');
        recordLastPrint({ at: Date.now(), ok: true, status: result.status, printId: result.printId });
      } catch (error) {
        recordLastPrint({ at: Date.now(), ok: false, message: error.message });
        throw error;
      }
    });
  });

  async function checkHealth() {
    try {
      const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      updateDispatcher(health.dispatcher ?? null);
      updatePaperLimit(health.maxPaperLengthInches ?? null);
      updateQueueDepth(health.queueDepth, health.queueMax);
      if (health.transportMode === 'File') {
        $('health').textContent = 'Development file mode';
        $('health').className = 'status';
        setPrintAvailability(false, 'Select an online Pi bridge to print.');
      } else if (health.printerAvailable) {
        $('health').textContent = 'Pi + printer online';
        $('health').className = 'status ok';
        setPrintAvailability(true);
      } else {
        $('health').textContent = 'Pi online';
        $('health').className = 'status warn';
        setPrintAvailability(true);
      }
    } catch {
      updateDispatcher(undefined);
      updatePaperLimit(undefined);
      updateQueueDepth(undefined, undefined);
      $('health').textContent = 'Pi offline';
      $('health').className = 'status bad';
      setPrintAvailability(false, 'The Pi bridge is offline.');
    }
  }

  loadBridgeUrl();
  loadPreferences();
  loadLastPrint();
  setMode(state.mode);
  syncOptions();
  checkHealth();
  setInterval(checkHealth, 5000);
})();
