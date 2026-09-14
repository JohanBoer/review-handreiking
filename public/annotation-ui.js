/* globals window, document, fetch, Node, NodeFilter, MutationObserver, confirm */
(function () {
  'use strict';

  let PAGE = window.__PROXY_PAGE__ || location.pathname;
  let annotations = [];
  let currentSel = null; // { text, prefix, suffix }
  let panelOpen = false;
  var anchored = new Set(); // IDs whose text was found in the current DOM

  // ── Build UI elements ────────────────────────────────────────────────────

  const panel = buildPanel();
  const addBtn = buildAddButton();
  const form = buildForm();
  const toggleBtn = buildToggle();
  const markPopup = buildMarkPopup();
  document.body.append(panel, addBtn, form, toggleBtn, markPopup);

  // ── SPA navigation detection (works with Docusaurus/React Router) ────────

  (function () {
    var _origPush = history.pushState.bind(history);
    history.pushState = function (s, t, u) {
      _origPush(s, t, u);
      var newPath = location.pathname; // already updated after _origPush
      if (newPath !== PAGE) { PAGE = newPath; setTimeout(onNavigate, 0); }
    };
    window.addEventListener('popstate', function () {
      var newPath = location.pathname;
      if (newPath !== PAGE) { PAGE = newPath; setTimeout(onNavigate, 0); }
    });
  }());

  // ── Init: load annotations and apply highlights ──────────────────────────

  waitForContent(loadAnnotations);

  function loadAnnotations() {
    fetch('/api/annotations?page=' + encodeURIComponent(PAGE))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        annotations = list;
        list.forEach(applyHighlight);
        renderPanel();
        ensureContentObserver();
      })
      .catch(function (e) { console.warn('[review] init failed:', e); });
  }

  // React (re)hydration can wipe our <mark> nodes after we've inserted them
  // (e.g. hydration mismatch recovery on a fresh full page load). Watch the
  // content root and re-anchor any annotation whose mark disappeared.
  var contentObserver = null;
  var reanchorTimer = null;
  function ensureContentObserver() {
    if (contentObserver) contentObserver.disconnect();
    contentObserver = new MutationObserver(function () {
      clearTimeout(reanchorTimer);
      reanchorTimer = setTimeout(reanchorMissing, 150);
    });
    contentObserver.observe(document.body, { childList: true, subtree: true });
  }

  function reanchorMissing() {
    annotations.forEach(function (ann) {
      if (!document.querySelector('mark[data-ann-id="' + ann.id + '"]')) applyHighlight(ann);
    });
  }

  function onNavigate() {
    // Clear highlights from previous page
    document.querySelectorAll('mark.ann-highlight').forEach(function (mark) {
      var frag = document.createDocumentFragment();
      while (mark.firstChild) frag.appendChild(mark.firstChild);
      mark.replaceWith(frag);
    });
    anchored = new Set();
    annotations = [];
    renderPanel();
    // Wait for React to finish rendering the new page content
    var snap = (getContentRoot() || document.body).textContent.slice(0, 300);
    var tries = 0;
    function waitChanged() {
      var cur = (getContentRoot() || document.body).textContent.slice(0, 300);
      if (cur !== snap && cur.trim().length > 80) { loadAnnotations(); return; }
      if (++tries < 40) { setTimeout(waitChanged, 100); return; }
      // Content never visibly changed (e.g. cached route on back/forward) — load anyway
      loadAnnotations();
    }
    setTimeout(waitChanged, 50);
  }

  // Wait until main content is rendered (handles VitePress hydration delay)
  function waitForContent(cb) {
    var attempts = 0;
    function check() {
      var root = getContentRoot();
      if (root && root.textContent.trim().length > 80) { cb(); return; }
      if (++attempts < 20) setTimeout(check, 150);
    }
    check();
  }

  function getContentRoot() {
    return document.querySelector('.vp-doc') ||
           document.querySelector('main article') ||
           document.querySelector('main') ||
           document.querySelector('[class*="content"]') ||
           document.body;
  }

  // ── Text selection handling ──────────────────────────────────────────────

  document.addEventListener('mouseup', function (e) {
    if (e.target.closest('.ann-panel,.ann-form,.ann-add-btn,.ann-toggle')) return;

    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideAddBtn(); return; }
    var text = sel.toString().trim();
    if (!text) { hideAddBtn(); return; }

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    currentSel = {
      text: text,
      prefix: getTextBefore(range, 40),
      suffix: getTextAfter(range, 40),
    };

    var left = Math.max(8, Math.min(rect.left, window.innerWidth - 240));
    addBtn.style.cssText = 'display:block;top:' + (rect.bottom + 8) + 'px;left:' + left + 'px';
  });

  document.addEventListener('mousedown', function (e) {
    if (!e.target.closest('.ann-add-btn,.ann-form')) {
      hideAddBtn();
      hideForm();
    }
  });

  function getTextBefore(range, n) {
    try {
      var r = document.createRange();
      r.setStart(range.startContainer, Math.max(0, range.startOffset - n));
      r.setEnd(range.startContainer, range.startOffset);
      return r.toString();
    } catch (e) { return ''; }
  }

  function getTextAfter(range, n) {
    try {
      var len = range.endContainer.textContent ? range.endContainer.textContent.length : 0;
      var r = document.createRange();
      r.setStart(range.endContainer, range.endOffset);
      r.setEnd(range.endContainer, Math.min(len, range.endOffset + n));
      return r.toString();
    } catch (e) { return ''; }
  }

  function hideAddBtn() {
    addBtn.style.display = 'none';
    currentSel = null;
  }

  function hideForm() {
    form.style.display = 'none';
  }

  // ── Annotation CRUD ──────────────────────────────────────────────────────

  function submitAnnotation(comment) {
    if (!currentSel || !comment.trim()) return;
    var payload = {
      page: PAGE,
      selectedText: currentSel.text,
      prefix: currentSel.prefix,
      suffix: currentSel.suffix,
      comment: comment.trim(),
    };
    fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (ann) {
        annotations.push(ann);
        applyHighlight(ann);
        renderPanel();
        hideForm();
        hideAddBtn();
        openPanel();
        focusAnnotation(ann.id);
      })
      .catch(function (e) { alert('Kon opmerking niet opslaan: ' + e.message); });
  }

  function deleteAnnotation(id) {
    fetch('/api/annotations/' + id, { method: 'DELETE' }).catch(function () {});
    annotations = annotations.filter(function (a) { return a.id !== id; });
    hideMarkPopup();
    var mark = document.querySelector('mark[data-ann-id="' + id + '"]');
    if (mark) {
      var frag = document.createDocumentFragment();
      while (mark.firstChild) frag.appendChild(mark.firstChild);
      mark.replaceWith(frag);
    }
    renderPanel();
  }

  // ── Mark popup (click on highlight) ─────────────────────────────────────

  function showMarkPopup(ann, e) {
    var popup = markPopup;
    setPopupEditMode(popup, ann);
    var left = Math.max(8, Math.min(e.clientX, window.innerWidth - 368));
    var top = Math.min(e.clientY + 12, window.innerHeight - 180);
    popup.style.cssText = 'display:block;top:' + top + 'px;left:' + left + 'px';
  }

  function setPopupViewMode(popup, ann) {
    popup.innerHTML =
      '<div class="ann-popup-comment">' + esc(ann.comment) + '</div>' +
      '<div class="ann-popup-actions">' +
      '  <button class="ann-popup-edit">\u270F Wijzigen</button>' +
      '  <button class="ann-popup-show">Paneel</button>' +
      '  <button class="ann-popup-del">\uD83D\uDDD1 Verwijder</button>' +
      '</div>';
    popup.querySelector('.ann-popup-edit').onclick = function () { setPopupEditMode(popup, ann); };
    popup.querySelector('.ann-popup-show').onclick = function () {
      hideMarkPopup(); openPanel(); focusAnnotation(ann.id);
    };
    popup.querySelector('.ann-popup-del').onclick = function () {
      if (confirm('Opmerking verwijderen?')) deleteAnnotation(ann.id);
    };
  }

  function setPopupEditMode(popup, ann) {
    popup.innerHTML =
      '<textarea class="ann-popup-ta" rows="4">' + esc(ann.comment) + '</textarea>' +
      '<div class="ann-popup-actions">' +
      '  <button class="ann-popup-save">Opslaan</button>' +
      '  <button class="ann-popup-cancel">Annuleren</button>' +
      '  <button class="ann-popup-del">Verwijder</button>' +
      '</div>';
    var ta = popup.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    popup.querySelector('.ann-popup-save').onclick = function () { saveEdit(popup, ann, ta.value); };
    popup.querySelector('.ann-popup-cancel').onclick = function () { hideMarkPopup(); };
    popup.querySelector('.ann-popup-del').onclick = function () {
      if (confirm('Opmerking verwijderen?')) deleteAnnotation(ann.id);
    };
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) saveEdit(popup, ann, ta.value);
      if (ev.key === 'Escape') setPopupViewMode(popup, ann);
    });
  }

  function saveEdit(popup, ann, newComment) {
    if (!newComment.trim()) return;
    fetch('/api/annotations/' + ann.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: newComment.trim() }),
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (updated) {
        ann.comment = updated.comment;
        // Update in-memory list and mark title
        var found = annotations.find(function (a) { return a.id === ann.id; });
        if (found) { found.comment = updated.comment; found.modified = updated.modified; }
        var mark = document.querySelector('mark[data-ann-id="' + ann.id + '"]');
        if (mark) mark.title = updated.comment;
        renderPanel();
        setPopupViewMode(popup, ann);
      })
      .catch(function (e) { alert('Opslaan mislukt: ' + e.message); });
  }

  function hideMarkPopup() {
    markPopup.style.display = 'none';
  }

  // Close popup when clicking elsewhere
  document.addEventListener('mousedown', function (e) {
    if (!e.target.closest('.ann-mark-popup')) hideMarkPopup();
  });

  // ── Text finding and highlighting ─────────────────────────────────────────

  function applyHighlight(ann) {
    try {
      var range = findRange(ann.selectedText, ann.prefix || '');
      if (!range) return;
      var mark = document.createElement('mark');
      mark.className = 'ann-highlight';
      mark.dataset.annId = ann.id;
      mark.title = ann.comment;
      mark.addEventListener('click', function (e) {
        e.stopPropagation();
        showMarkPopup(ann, e);
      });
      try {
        range.surroundContents(mark);
      } catch (e) {
        var frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      }
      anchored.add(ann.id);
    } catch (e) { /* text not found or DOM error – skip */ }
  }

  function findRange(selectedText, prefix) {
    var root = getContentRoot();
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (p && p.closest('.ann-panel,.ann-form,.ann-add-btn,.ann-toggle,script,style'))
          return NodeFilter.FILTER_REJECT;
        return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    var full = '';
    var bounds = nodes.map(function (node) {
      var s = full.length;
      full += node.textContent;
      return { node: node, s: s, e: full.length };
    });

    var textStart;
    if (prefix) {
      var idx = full.indexOf(prefix + selectedText);
      textStart = idx !== -1 ? idx + prefix.length : full.indexOf(selectedText);
    } else {
      textStart = full.indexOf(selectedText);
    }
    if (textStart === -1) return null;

    var textEnd = textStart + selectedText.length;
    var sb = bounds.find(function (b) { return b.s <= textStart && b.e > textStart; });
    var eb = bounds.find(function (b) { return b.s < textEnd && b.e >= textEnd; });
    if (!sb || !eb) return null;

    var range = document.createRange();
    range.setStart(sb.node, textStart - sb.s);
    range.setEnd(eb.node, textEnd - eb.s);
    return range;
  }

  // ── Panel ────────────────────────────────────────────────────────────────

  function openPanel() {
    panelOpen = true;
    panel.classList.add('ann-panel--open');
    toggleBtn.title = 'Sluit opmerkingenpaneel';
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove('ann-panel--open');
    toggleBtn.title = 'Open opmerkingenpaneel (' + annotations.length + ')';
  }

  function focusAnnotation(id) {
    panel.querySelectorAll('.ann-item').forEach(function (el) { el.classList.remove('ann-item--active'); });
    document.querySelectorAll('mark.ann-highlight').forEach(function (el) { el.classList.remove('ann-highlight--active'); });

    var item = panel.querySelector('[data-ann-id="' + id + '"]');
    if (item) {
      item.classList.add('ann-item--active');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    var mark = document.querySelector('mark[data-ann-id="' + id + '"]');
    if (mark) {
      mark.classList.add('ann-highlight--active');
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { mark.classList.remove('ann-highlight--active'); }, 2500);
    }
  }

  function renderPanel() {
    var list = panel.querySelector('.ann-list');
    var countEl = panel.querySelector('.ann-count');
    var n = annotations.length;
    countEl.textContent = n + ' opmerking' + (n === 1 ? '' : 'en');
    toggleBtn.setAttribute('data-count', n);

    if (n === 0) {
      list.innerHTML = '<p class="ann-empty">Selecteer tekst in het document om een opmerking toe te voegen.</p>';
      return;
    }

    // Sort by position in document
    var sorted = annotations.slice().sort(function (a, b) {
      var ma = document.querySelector('mark[data-ann-id="' + a.id + '"]');
      var mb = document.querySelector('mark[data-ann-id="' + b.id + '"]');
      if (!ma || !mb) return new Date(a.timestamp) - new Date(b.timestamp);
      return ma.compareDocumentPosition(mb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    list.innerHTML = '';
    sorted.forEach(function (ann) {
      var item = document.createElement('div');
      item.className = 'ann-item';
      item.dataset.annId = ann.id;
      var excerpt = ann.selectedText.length > 120
        ? ann.selectedText.slice(0, 120) + '\u2026'
        : ann.selectedText;
      var date = new Date(ann.timestamp).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      var dateLabel = ann.modified
        ? 'Gewijzigd: ' + new Date(ann.modified).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : date;
      var orphaned = !anchored.has(ann.id);
      if (orphaned) item.classList.add('ann-item--orphaned');
      item.innerHTML =
        '<div class="ann-quote">' + esc(excerpt) + '</div>' +
        '<div class="ann-comment">' + esc(ann.comment) + '</div>' +
        '<div class="ann-meta"><span class="ann-date">' + esc(dateLabel) + '</span>' +
        (orphaned ? '<span class="ann-orphan-badge" title="Tekst niet meer gevonden in het document">\u26A0\uFE0F Tekst gewijzigd</span>' : '') +
        '<button class="ann-del" title="Verwijder opmerking">\u2715</button></div>';

      item.querySelector('.ann-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (confirm('Opmerking verwijderen?')) deleteAnnotation(ann.id);
      });
      item.addEventListener('click', function () {
        openPanel();
        focusAnnotation(ann.id);
      });
      item.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        showMarkPopup(ann, e);
      });
      list.appendChild(item);
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── DOM builders ─────────────────────────────────────────────────────────

  function buildPanel() {
    var el = document.createElement('div');
    el.className = 'ann-panel';
    el.innerHTML =
      '<div class="ann-panel-header">' +
      '  <h3 class="ann-panel-title">Opmerkingen</h3>' +
      '  <span class="ann-count"></span>' +
      '  <button class="ann-close-btn" title="Sluit paneel">\u2715</button>' +
      '</div>' +
      '<div class="ann-list"></div>';
    el.querySelector('.ann-close-btn').addEventListener('click', closePanel);
    return el;
  }

  function buildAddButton() {
    var el = document.createElement('button');
    el.className = 'ann-add-btn';
    el.textContent = '\uD83D\uDCAC Opmerking toevoegen';
    el.style.display = 'none';
    // Prevent mousedown from clearing the text selection
    el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!currentSel) return;
      var r = el.getBoundingClientRect();
      el.style.display = 'none';
      var left = Math.max(8, Math.min(r.left, window.innerWidth - 340));
      var top = Math.min(r.bottom + 4, window.innerHeight - 220);
      form.style.cssText = 'display:block;top:' + top + 'px;left:' + left + 'px';
      form.querySelector('textarea').value = '';
      form.querySelector('textarea').focus();
    });
    return el;
  }

  function buildForm() {
    var el = document.createElement('div');
    el.className = 'ann-form';
    el.style.display = 'none';
    el.innerHTML =
      '<div class="ann-form-label">Opmerking bij geselecteerde tekst:</div>' +
      '<textarea class="ann-form-ta" rows="4" placeholder="Typ uw opmerking\u2026"></textarea>' +
      '<div class="ann-form-btns">' +
      '  <button class="ann-form-submit">Opslaan</button>' +
      '  <button class="ann-form-cancel">Annuleren</button>' +
      '  <span class="ann-form-hint">Ctrl+Enter</span>' +
      '</div>';

    el.querySelector('.ann-form-submit').addEventListener('click', function () {
      var v = el.querySelector('textarea').value;
      if (v.trim()) submitAnnotation(v);
      else hideForm();
    });
    el.querySelector('.ann-form-cancel').addEventListener('click', hideForm);
    el.querySelector('textarea').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        var v = el.querySelector('textarea').value;
        if (v.trim()) submitAnnotation(v);
      }
      if (e.key === 'Escape') hideForm();
    });
    return el;
  }

  function buildToggle() {
    var el = document.createElement('button');
    el.className = 'ann-toggle';
    el.title = 'Open opmerkingenpaneel';
    el.setAttribute('data-count', '0');
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    el.addEventListener('click', function () { panelOpen ? closePanel() : openPanel(); });
    return el;
  }

  function buildMarkPopup() {
    var el = document.createElement('div');
    el.className = 'ann-mark-popup';
    el.style.display = 'none';
    return el;
  }
}());
