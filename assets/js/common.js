/* Cumhuriyet Avukatları PDF Araçları — ortak yardımcılar
   Tüm işlemler tarayıcıda gerçekleşir; hiçbir dosya sunucuya gönderilmez. */
'use strict';

/* mobil menü + mega menü klavye desteği */
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

  /* ---- Dosya listesi: önizlemeli kartlar, sürükle-bırak sıralama ---- */

  var FILE_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>';

  var dragSrcIndex = null;

  function renderFileList(files, opts, onChange) {
    var list = $('#file-list');
    if (!list) return;
    opts = opts || {};
    list.innerHTML = '';
    list.className = 'file-list file-grid';
    if (!files.length) return;

    if (opts.reorder && files.length > 1) {
      var hint = document.createElement('div');
      hint.className = 'fg-hint';
      hint.textContent = 'Sıralamayı sürükleyerek veya ok tuşlarıyla değiştirebilirsiniz.';
      list.appendChild(hint);
    }

    var grid = document.createElement('div');
    grid.className = 'fg-cards';
    list.appendChild(grid);

    files.forEach(function (f, i) {
      var card = document.createElement('div');
      card.className = 'file-card';

      if (opts.reorder && files.length > 1) {
        card.draggable = true;
        card.addEventListener('dragstart', function (e) {
          dragSrcIndex = i;
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) {}
        });
        card.addEventListener('dragend', function () {
          dragSrcIndex = null;
          card.classList.remove('dragging');
        });
        card.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', function () { card.classList.remove('drag-over'); });
        card.addEventListener('drop', function (e) {
          e.preventDefault();
          card.classList.remove('drag-over');
          if (dragSrcIndex === null || dragSrcIndex === i) return;
          var item = files.splice(dragSrcIndex, 1)[0];
          files.splice(i, 0, item);
          dragSrcIndex = null;
          onChange();
        });
      }

      /* sıra rozeti */
      if (files.length > 1) {
        var num = document.createElement('span');
        num.className = 'fc-num';
        num.textContent = i + 1;
        card.appendChild(num);
      }

      /* kaldır */
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'fc-del';
      del.title = 'Kaldır';
      del.innerHTML = '&times;';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        files.splice(i, 1);
        onChange();
      });
      card.appendChild(del);

      /* önizleme */
      var thumb = document.createElement('div');
      thumb.className = 'fc-thumb';
      thumb.innerHTML = FILE_ICON;
      card.appendChild(thumb);

      var name = document.createElement('div');
      name.className = 'fc-name';
      name.textContent = f.name;
      name.title = f.name;
      card.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'fc-meta';
      meta.textContent = formatBytes(f.size);
      card.appendChild(meta);

      if (opts.thumb) {
        Promise.resolve(opts.thumb(f)).then(function (res) {
          if (!res || !res.url) return;
          var img = document.createElement('img');
          img.src = res.url;
          img.alt = f.name;
          thumb.innerHTML = '';
          thumb.appendChild(img);
          if (res.label) meta.textContent = formatBytes(f.size) + ' · ' + res.label;
        }).catch(function () {});
      }

      /* ok tuşları (dokunmatik cihazlar için) */
      if (opts.reorder && files.length > 1) {
        var acts = document.createElement('div');
        acts.className = 'fc-actions';
        acts.appendChild(iconBtn('‹', 'Öne taşı', i === 0, function () {
          var t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; onChange();
        }));
        acts.appendChild(iconBtn('›', 'Arkaya taşı', i === files.length - 1, function () {
          var t = files[i + 1]; files[i + 1] = files[i]; files[i] = t; onChange();
        }));
        card.appendChild(acts);
      }

      grid.appendChild(card);
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
