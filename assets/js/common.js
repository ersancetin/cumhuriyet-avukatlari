/* Cumhuriyet Avukatları PDF Araçları — ortak yardımcılar
   Tüm işlemler tarayıcıda gerçekleşir; hiçbir dosya sunucuya gönderilmez. */
'use strict';

/* mobil menü */
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) nav.classList.remove('open');
  });
});

window.CA = (function () {

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function formatBytes(n) {
    if (n === 0) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(n) / Math.log(1024));
    i = Math.min(i, u.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Dosya okunamadı: ' + file.name)); };
      r.readAsArrayBuffer(file);
    });
  }

  /* "1-3, 5, 8-10" -> 0 tabanlı sayfa dizisi. Hata varsa null döner. */
  function parseRanges(str, max) {
    var out = [];
    var parts = String(str || '').split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a < 1 || b < a || b > max) return null;
        for (var k = a; k <= b; k++) out.push(k - 1);
      } else if (/^\d+$/.test(p)) {
        var v = parseInt(p, 10);
        if (v < 1 || v > max) return null;
        out.push(v - 1);
      } else {
        return null;
      }
    }
    return out.length ? out : null;
  }

  /* ---- Durum / ilerleme ---- */

  function setProgress(pct, msg) {
    var wrap = $('#progress-wrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    $('#progress-fill').style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (msg !== undefined) $('#status-text').textContent = msg;
  }

  function hideProgress() {
    var wrap = $('#progress-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  function showError(msg) {
    var box = $('#error-box');
    if (!box) return;
    box.textContent = msg;
    box.style.display = 'block';
  }

  function clearError() {
    var box = $('#error-box');
    if (box) box.style.display = 'none';
  }

  function showResult(title, sub, downloads) {
    var area = $('#result-area');
    if (!area) return;
    var box = $('.result-box', area);
    $('.r-title', box).textContent = title;
    $('.r-sub', box).textContent = sub || '';
    var btns = $('.r-actions', box);
    btns.innerHTML = '';
    downloads.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'btn btn-primary';
      b.textContent = d.label;
      b.addEventListener('click', function () { download(d.blob, d.name); });
      btns.appendChild(b);
    });
    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideResult() {
    var area = $('#result-area');
    if (area) area.style.display = 'none';
  }

  /* ---- Dosya seçimi (tıkla + sürükle-bırak) ---- */

  function initDropzone(opts) {
    var dz = $('#dropzone');
    var input = $('#file-input');
    if (!dz || !input) return;

    function accepted(file) {
      if (!opts.extensions || !opts.extensions.length) return true;
      var name = file.name.toLowerCase();
      return opts.extensions.some(function (ext) { return name.endsWith(ext); });
    }

    function handle(fileList) {
      var files = Array.from(fileList).filter(accepted);
      var rejected = fileList.length - files.length;
      if (rejected > 0) {
        showError(rejected + ' dosya desteklenmeyen türde olduğu için atlandı. Desteklenen: ' + opts.extensions.join(', '));
      } else {
        clearError();
      }
      if (files.length) opts.onFiles(files);
    }

    dz.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files.length) handle(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) handle(e.dataTransfer.files);
    });
  }

  /* ---- Dosya listesi (sıralama / silme destekli) ---- */

  var FILE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>';

  function renderFileList(files, opts, onChange) {
    var list = $('#file-list');
    if (!list) return;
    list.innerHTML = '';
    files.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'file-row';

      var icon = document.createElement('span');
      icon.className = 'f-icon';
      icon.innerHTML = FILE_ICON;

      var name = document.createElement('span');
      name.className = 'f-name';
      name.textContent = f.name;
      name.title = f.name;

      var meta = document.createElement('span');
      meta.className = 'f-meta';
      meta.textContent = formatBytes(f.size);

      var actions = document.createElement('span');
      actions.className = 'f-actions';

      if (opts && opts.reorder) {
        var up = iconBtn('↑', 'Yukarı taşı', i === 0, function () {
          var t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; onChange();
        });
        var down = iconBtn('↓', 'Aşağı taşı', i === files.length - 1, function () {
          var t = files[i + 1]; files[i + 1] = files[i]; files[i] = t; onChange();
        });
        actions.appendChild(up);
        actions.appendChild(down);
      }
      var del = iconBtn('×', 'Kaldır', false, function () {
        files.splice(i, 1); onChange();
      });
      actions.appendChild(del);

      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function iconBtn(txt, title, disabled, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.textContent = txt;
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  /* ---- Seçenek grupları (radio görünümlü butonlar) ---- */

  function initChoices() {
    $$('.opt-row').forEach(function (row) {
      $$('.opt-choice', row).forEach(function (ch) {
        ch.addEventListener('click', function () {
          $$('.opt-choice', row).forEach(function (c) { c.classList.remove('active'); });
          ch.classList.add('active');
          row.dispatchEvent(new CustomEvent('choice', { detail: ch.dataset.value }));
        });
      });
    });
  }

  function choiceValue(rowId) {
    var row = document.getElementById(rowId);
    var active = row ? $('.opt-choice.active', row) : null;
    return active ? active.dataset.value : null;
  }

  return {
    $: $, $$: $$,
    formatBytes: formatBytes,
    download: download,
    readFile: readFile,
    parseRanges: parseRanges,
    setProgress: setProgress,
    hideProgress: hideProgress,
    showError: showError,
    clearError: clearError,
    showResult: showResult,
    hideResult: hideResult,
    initDropzone: initDropzone,
    renderFileList: renderFileList,
    initChoices: initChoices,
    choiceValue: choiceValue
  };
})();
