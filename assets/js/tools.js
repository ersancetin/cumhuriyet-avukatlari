/* Cumhuriyet Avukatları PDF Araçları — araç motoru
   Tüm işlemler tarayıcıda gerçekleşir; hiçbir dosya sunucuya gönderilmez. */
'use strict';

(function () {
  var tool = document.body.dataset.tool;
  if (!tool) return;

  var $ = CA.$;
  var A4 = { w: 595.28, h: 841.89 };

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../assets/vendor/pdf.worker.min.js';
  }

  /* ---------- ortak yardımcılar ---------- */

  function baseName(name) {
    return name.replace(/\.[^.]+$/, '');
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('Görsel oluşturulamadı.'));
      }, type, quality);
    });
  }

  function loadPdf(buffer, fileName) {
    return PDFLib.PDFDocument.load(buffer, { ignoreEncryption: false })
      .catch(function (e) {
        if (/encrypted/i.test(String(e))) {
          throw new Error('"' + fileName + '" şifre korumalı. Lütfen önce şifresini kaldırın.');
        }
        throw new Error('"' + fileName + '" okunamadı. Dosya bozuk veya geçerli bir PDF değil.');
      });
  }

  function renderPdfPages(buffer, scale, onPage, progressText) {
    /* pdf.js ile her sayfayı canvas'a çizer; onPage(canvas, index, total, pointSize) çağırır. */
    return pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: '../assets/vendor/standard_fonts/'
    }).promise.then(function (doc) {
      var total = doc.numPages;
      var chain = Promise.resolve();
      var results = [];
      var idxs = [];
      for (var i = 1; i <= total; i++) idxs.push(i);
      idxs.forEach(function (i) {
        chain = chain.then(function () {
          CA.setProgress(((i - 1) / total) * 90, progressText + ' (' + i + '/' + total + ')');
          return doc.getPage(i).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width);
            canvas.height = Math.ceil(vp.height);
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              return Promise.resolve(onPage(canvas, i, total, { w: vp1.width, h: vp1.height }))
                .then(function (r) { results.push(r); page.cleanup(); });
            });
          });
        });
      });
      return chain.then(function () { return { results: results, total: total }; });
    }, function () {
      throw new Error('PDF açılamadı. Dosya bozuk veya şifre korumalı olabilir.');
    });
  }

  function zipBlobs(entries) {
    var zip = new JSZip();
    entries.forEach(function (e) { zip.file(e.name, e.blob); });
    return zip.generateAsync({ type: 'blob' }, function (meta) {
      CA.setProgress(90 + meta.percent * 0.1, 'Arşiv hazırlanıyor…');
    });
  }

  /* ---- döndürülmüş (/Rotate'li) sayfalara doğru damgalama ----
     Taranmış PDF'lerde sayfa içeriği çoğu zaman /Rotate ile çevrilir; metni
     ham koordinatlara basmak numara/filigranı yanlış kenara düşürür. Bu
     yardımcılar "ekranda görünen" koordinatı sayfa koordinatına çevirir. */

  function visualBox(page) {
    var rot = ((page.getRotation().angle % 360) + 360) % 360;
    var w = page.getWidth(), h = page.getHeight();
    var swap = (rot === 90 || rot === 270);
    return { rot: rot, w: w, h: h, vw: swap ? h : w, vh: swap ? w : h };
  }

  function toPagePoint(box, vx, vy) {
    switch (box.rot) {
      case 90: return { x: box.w - vy, y: vx };
      case 180: return { x: box.w - vx, y: box.h - vy };
      case 270: return { x: vy, y: box.h - vx };
      default: return { x: vx, y: vy };
    }
  }

  /* ---- önizleme üreticileri (küçük resimler) ---- */

  var thumbCache = new WeakMap();

  function cachedThumb(file, maker) {
    if (thumbCache.has(file)) return thumbCache.get(file);
    var p = Promise.resolve().then(maker).catch(function () { return null; });
    thumbCache.set(file, p);
    return p;
  }

  function pdfThumb(file) {
    return cachedThumb(file, function () {
      if (!window.pdfjsLib) return null;
      return CA.readFile(file).then(function (buf) {
        return pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          standardFontDataUrl: '../assets/vendor/standard_fonts/'
        }).promise;
      }).then(function (doc) {
        return doc.getPage(1).then(function (page) {
          var vp1 = page.getViewport({ scale: 1 });
          var scale = 200 / vp1.width;
          var vp = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
            var url = canvas.toDataURL('image/jpeg', 0.8);
            var pages = doc.numPages;
            doc.destroy();
            return { url: url, label: pages + ' sayfa' };
          });
        });
      });
    });
  }

  function imgThumb(file) {
    return cachedThumb(file, function () {
      return { url: URL.createObjectURL(file) };
    });
  }

  function tiffThumb(file) {
    return cachedThumb(file, function () {
      if (!window.UTIF) return null;
      return CA.readFile(file).then(function (buf) {
        var ifds = UTIF.decode(buf);
        if (!ifds.length) return null;
        UTIF.decodeImage(buf, ifds[0], ifds);
        var rgba = UTIF.toRGBA8(ifds[0]);
        var w = ifds[0].width, h = ifds[0].height;
        var src = document.createElement('canvas');
        src.width = w; src.height = h;
        var sctx = src.getContext('2d');
        var imgData = sctx.createImageData(w, h);
        imgData.data.set(rgba);
        sctx.putImageData(imgData, 0, 0);
        src = orientCanvas(src, ifds[0].t274 ? ifds[0].t274[0] : 1);
        w = src.width; h = src.height;
        var scale = Math.min(1, 200 / w);
        var out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * scale));
        out.height = Math.max(1, Math.round(h * scale));
        out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
        return { url: out.toDataURL('image/jpeg', 0.8), label: ifds.length + ' sayfa' };
      });
    });
  }

  function runGuard(btn, fn) {
    return function () {
      CA.clearError();
      CA.hideResult();
      btn.disabled = true;
      Promise.resolve()
        .then(fn)
        .catch(function (e) {
          console.error(e);
          CA.hideProgress();
          CA.showError(e && e.message ? e.message : 'Beklenmeyen bir hata oluştu.');
        })
        .then(function () { btn.disabled = false; });
    };
  }

  function singleFileState(extensions, label, thumb) {
    var state = { file: null };
    function rerender() {
      CA.hideResult();
      CA.renderFileList(state.file ? [state.file] : [], { thumb: thumb }, function () {
        state.file = null;
        rerender();
        if (state.onCleared) state.onCleared();
      });
    }
    CA.initDropzone({
      extensions: extensions,
      onFiles: function (files) {
        state.file = files[0];
        rerender();
        if (state.onSelected) state.onSelected(state.file);
      }
    });
    state.require = function () {
      if (!state.file) throw new Error(label || 'Lütfen önce bir PDF dosyası seçin.');
      return state.file;
    };
    return state;
  }

  function multiFileState(extensions, opts) {
    var state = { files: [] };
    function rerender() {
      CA.hideResult();
      CA.renderFileList(state.files, opts || { reorder: true }, rerender);
    }
    CA.initDropzone({
      extensions: extensions,
      onFiles: function (files) {
        files.forEach(function (f) { state.files.push(f); });
        rerender();
      }
    });
    state.require = function (min, msg) {
      if (state.files.length < min) throw new Error(msg);
      return state.files;
    };
    return state;
  }

  /* JPEG'in EXIF yön etiketini okur (1 = düz). Telefon fotoğrafları çoğunlukla
     pikselleri döndürülmemiş kaydedip yönü bu etiketle bildirir. */
  function jpegOrientation(buf) {
    try {
      var view = new DataView(buf);
      if (view.getUint16(0) !== 0xFFD8) return 1;
      var offset = 2, length = view.byteLength;
      while (offset < length - 4) {
        var marker = view.getUint16(offset);
        offset += 2;
        if (marker === 0xFFE1) {
          if (view.getUint32(offset + 2) !== 0x45786966) return 1; /* "Exif" */
          var tiff = offset + 8;
          var little = view.getUint16(tiff) === 0x4949;
          var get16 = function (o) { return view.getUint16(o, little); };
          var get32 = function (o) { return view.getUint32(o, little); };
          var ifdOff = get32(tiff + 4);
          if (tiff + ifdOff + 2 > length) return 1;
          var entries = get16(tiff + ifdOff);
          for (var i = 0; i < entries; i++) {
            var e = tiff + ifdOff + 2 + i * 12;
            if (e + 10 > length) return 1;
            if (get16(e) === 0x0112) return get16(e + 8) || 1;
          }
          return 1;
        }
        if ((marker & 0xFF00) !== 0xFF00) return 1;
        offset += view.getUint16(offset);
      }
      return 1;
    } catch (e) {
      return 1;
    }
  }

  /* görseli canvas üzerinden PNG/JPEG byte'larına çevirir; EXIF yönünü uygular */
  function fileToCanvas(file) {
    var bmpPromise;
    try {
      bmpPromise = createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      bmpPromise = createImageBitmap(file);
    }
    return bmpPromise.catch(function () {
      /* bazı tarayıcılar seçenek nesnesini desteklemez */
      return createImageBitmap(file);
    }).then(function (bmp) {
      var canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return canvas;
    }, function () {
      throw new Error('"' + file.name + '" görseli açılamadı. Dosya bozuk olabilir.');
    });
  }

  /* Çıktı boyutu ön ayarları: uzun kenar piksel sınırı + JPEG kalitesi.
     Taramalar çoğu zaman 300 DPI gelir; UYAP/e-posta için küçültmek gerekir. */
  var SIZE_PRESETS = {
    kucuk: { edge: 1500, q: 0.6 },
    dengeli: { edge: 2200, q: 0.76 },
    yuksek: { edge: 0, q: 0.92 }
  };

  function sizePreset() {
    return SIZE_PRESETS[CA.choiceValue('opt-size') || 'dengeli'] || SIZE_PRESETS.dengeli;
  }

  /* uzun kenarı maxEdge pikseli aşan canvas'ı küçültür (0 = dokunma) */
  function downscaleCanvas(canvas, maxEdge) {
    var long = Math.max(canvas.width, canvas.height);
    if (!maxEdge || long <= maxEdge) return canvas;
    var scale = maxEdge / long;
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  /* TIFF yön etiketi (t274) için canvas'ı döndürür */
  function orientCanvas(canvas, o) {
    if (!o || o === 1) return canvas;
    var w = canvas.width, h = canvas.height;
    var out = document.createElement('canvas');
    var swap = (o === 6 || o === 8);
    out.width = swap ? h : w;
    out.height = swap ? w : h;
    var ctx = out.getContext('2d');
    if (o === 3) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    else if (o === 6) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    else if (o === 8) { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
    else { return canvas; }
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  function addImagePage(pdfDoc, image, pageMode, margin) {
    var iw = image.width, ih = image.height;
    var pw, ph;
    if (pageMode === 'auto') {
      /* 96dpi piksel -> punto; sayfa görsel boyutunda */
      pw = iw * 72 / 96 + margin * 2;
      ph = ih * 72 / 96 + margin * 2;
    } else if (pageMode === 'a4auto') {
      /* sayfa yönü görselin yönüne uyar */
      if (iw > ih) { pw = A4.h; ph = A4.w; } else { pw = A4.w; ph = A4.h; }
    } else if (pageMode === 'a4l') {
      pw = A4.h; ph = A4.w;
    } else {
      pw = A4.w; ph = A4.h;
    }
    var maxW = pw - margin * 2, maxH = ph - margin * 2;
    var scale = Math.min(maxW / iw, maxH / ih);
    var dw = iw * scale, dh = ih * scale;
    var page = pdfDoc.addPage([pw, ph]);
    page.drawImage(image, {
      x: (pw - dw) / 2,
      y: (ph - dh) / 2,
      width: dw,
      height: dh
    });
  }

  function embedImageFile(pdfDoc, file, preset) {
    var name = file.name.toLowerCase();
    preset = preset || SIZE_PRESETS.yuksek;

    function viaCanvasJpeg() {
      return fileToCanvas(file)
        .then(function (c) { return canvasToBlob(downscaleCanvas(c, preset.edge), 'image/jpeg', preset.q); })
        .then(function (b) { return b.arrayBuffer(); })
        .then(function (ab) { return pdfDoc.embedJpg(ab); });
    }

    return CA.readFile(file).then(function (buf) {
      if (/\.(jpg|jpeg)$/.test(name)) {
        /* Kucultme isteniyorsa veya EXIF yon etiketi varsa canvas uzerinden;
           aksi halde orijinal byte'lar kayipsiz gomulur */
        if (preset.edge || jpegOrientation(buf) !== 1) return viaCanvasJpeg();
        return pdfDoc.embedJpg(buf).catch(viaCanvasJpeg); /* CMYK/progresif JPG */
      }
      if (/\.png$/.test(name)) {
        /* PNG'ler (ekran goruntusu, belge) keskin kalsin diye PNG kalir;
           gerekiyorsa yalnizca kucultulur */
        if (preset.edge) {
          return fileToCanvas(file).then(function (c) {
            var small = downscaleCanvas(c, preset.edge);
            return canvasToBlob(small, 'image/png')
              .then(function (b) { return b.arrayBuffer(); })
              .then(function (ab) { return pdfDoc.embedPng(ab); });
          });
        }
        return pdfDoc.embedPng(buf).catch(function () {
          return fileToCanvas(file)
            .then(function (c) { return canvasToBlob(c, 'image/png'); })
            .then(function (b) { return b.arrayBuffer(); })
            .then(function (ab) { return pdfDoc.embedPng(ab); });
        });
      }
      /* webp vb. */
      return viaCanvasJpeg();
    });
  }

  /* ---------- araçlar ---------- */

  var tools = {};

  /* --- PDF Birleştir --- */
  tools.merge = function () {
    var state = multiFileState(['.pdf'], { reorder: true, thumb: pdfThumb });
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var files = state.require(2, 'Birleştirmek için en az 2 PDF dosyası seçin.');
      CA.setProgress(0, 'Birleştiriliyor…');
      var out;
      return PDFLib.PDFDocument.create().then(function (doc) {
        out = doc;
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () {
            CA.setProgress((i / files.length) * 95, '"' + f.name + '" ekleniyor… (' + (i + 1) + '/' + files.length + ')');
            return CA.readFile(f)
              .then(function (buf) { return loadPdf(buf, f.name); })
              .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
              .then(function (pages) { pages.forEach(function (p) { out.addPage(p); }); });
          });
        });
        return chain;
      }).then(function () {
        CA.setProgress(97, 'Dosya oluşturuluyor…');
        return out.save();
      }).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        CA.setProgress(100, 'Tamamlandı.');
        CA.hideProgress();
        CA.showResult(
          files.length + ' PDF tek dosyada birleştirildi',
          out.getPageCount() + ' sayfa · ' + CA.formatBytes(blob.size),
          [{ label: 'PDF\'i İndir', blob: blob, name: baseName(files[0].name) + '_birlestirilmis.pdf' }]
        );
      });
    }));
  };

  /* --- PDF Ayır --- */
  tools.split = function () {
    var state = singleFileState(['.pdf'], 'Lütfen önce bir PDF dosyası seçin.', pdfThumb);
    var btn = $('#run-btn');
    var rangeInput = $('#ranges-input');

    var rangeRow = $('#opt-mode');
    rangeRow.addEventListener('choice', function (e) {
      $('#ranges-group').style.display = e.detail === 'ranges' ? 'block' : 'none';
    });

    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var mode = CA.choiceValue('opt-mode');
      CA.setProgress(0, 'PDF okunuyor…');
      return CA.readFile(file)
        .then(function (buf) { return loadPdf(buf, file.name); })
        .then(function (src) {
          var total = src.getPageCount();
          var base = baseName(file.name);

          if (mode === 'ranges') {
            var idxs = CA.parseRanges(rangeInput.value, total);
            if (!idxs) throw new Error('Sayfa aralığı geçersiz. Örnek: 1-3, 5, 8-10 (belge ' + total + ' sayfa)');
            return PDFLib.PDFDocument.create().then(function (out) {
              return out.copyPages(src, idxs).then(function (pages) {
                pages.forEach(function (p) { out.addPage(p); });
                CA.setProgress(80, 'Dosya oluşturuluyor…');
                return out.save();
              }).then(function (bytes) {
                var blob = new Blob([bytes], { type: 'application/pdf' });
                CA.hideProgress();
                CA.showResult(
                  idxs.length + ' sayfa çıkarıldı',
                  CA.formatBytes(blob.size),
                  [{ label: 'PDF\'i İndir', blob: blob, name: base + '_secili-sayfalar.pdf' }]
                );
              });
            });
          }

          /* her sayfa ayrı PDF -> ZIP */
          var entries = [];
          var chain = Promise.resolve();
          for (var i = 0; i < total; i++) {
            (function (i) {
              chain = chain.then(function () {
                CA.setProgress((i / total) * 85, 'Sayfa ' + (i + 1) + '/' + total + ' ayrılıyor…');
                return PDFLib.PDFDocument.create().then(function (out) {
                  return out.copyPages(src, [i]).then(function (pages) {
                    out.addPage(pages[0]);
                    return out.save();
                  }).then(function (bytes) {
                    entries.push({
                      name: base + '_sayfa-' + pad(i + 1, String(total).length) + '.pdf',
                      blob: new Blob([bytes], { type: 'application/pdf' })
                    });
                  });
                });
              });
            })(i);
          }
          return chain.then(function () {
            return zipBlobs(entries);
          }).then(function (zipBlob) {
            CA.hideProgress();
            CA.showResult(
              total + ' sayfa, ' + total + ' ayrı PDF olarak kaydedildi',
              'ZIP arşivi · ' + CA.formatBytes(zipBlob.size),
              [{ label: 'ZIP\'i İndir', blob: zipBlob, name: base + '_sayfalar.zip' }]
            );
          });
        });
    }));
  };

  /* --- Görsel (JPG/PNG/WebP) -> PDF --- */
  tools.image2pdf = function () {
    var state = multiFileState(['.jpg', '.jpeg', '.png', '.webp'], { reorder: true, thumb: imgThumb });
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var files = state.require(1, 'Lütfen en az bir görsel seçin (JPG, PNG veya WebP).');
      var pageMode = CA.choiceValue('opt-pagesize') || 'a4auto';
      var margin = parseFloat(CA.choiceValue('opt-margin') || '0');
      var preset = sizePreset();
      var out;
      return PDFLib.PDFDocument.create().then(function (doc) {
        out = doc;
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () {
            CA.setProgress((i / files.length) * 90, '"' + f.name + '" ekleniyor… (' + (i + 1) + '/' + files.length + ')');
            return embedImageFile(out, f, preset).then(function (img) {
              addImagePage(out, img, pageMode, margin);
            });
          });
        });
        return chain;
      }).then(function () {
        CA.setProgress(95, 'PDF oluşturuluyor…');
        return out.save();
      }).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        CA.hideProgress();
        var name = baseName(files[0].name) + '.pdf';
        CA.showResult(
          files.length + ' görsel PDF\'e dönüştürüldü',
          out.getPageCount() + ' sayfa · ' + CA.formatBytes(blob.size),
          [{ label: 'PDF\'i İndir', blob: blob, name: name }]
        );
      });
    }));
  };

  /* --- TIFF -> PDF --- */
  tools.tiff2pdf = function () {
    var state = multiFileState(['.tif', '.tiff'], { reorder: true, thumb: tiffThumb });
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var files = state.require(1, 'Lütfen en az bir TIFF dosyası seçin.');
      var pageMode = CA.choiceValue('opt-pagesize') || 'auto';
      var preset = sizePreset();
      var out;
      return PDFLib.PDFDocument.create().then(function (doc) {
        out = doc;
        var chain = Promise.resolve();
        files.forEach(function (f, fi) {
          chain = chain.then(function () {
            CA.setProgress((fi / files.length) * 10, '"' + f.name + '" okunuyor…');
            return CA.readFile(f).then(function (buf) {
              var ifds;
              try {
                ifds = UTIF.decode(buf);
              } catch (e) {
                throw new Error('"' + f.name + '" geçerli bir TIFF dosyası değil.');
              }
              if (!ifds.length) throw new Error('"' + f.name + '" içinde sayfa bulunamadı.');
              var pageChain = Promise.resolve();
              ifds.forEach(function (ifd, pi) {
                pageChain = pageChain.then(function () {
                  CA.setProgress(
                    10 + ((fi + (pi / ifds.length)) / files.length) * 80,
                    '"' + f.name + '" sayfa ' + (pi + 1) + '/' + ifds.length + ' dönüştürülüyor…'
                  );
                  try {
                    UTIF.decodeImage(buf, ifd, ifds);
                  } catch (e) {
                    throw new Error('"' + f.name + '" sayfa ' + (pi + 1) + ' çözülemedi (desteklenmeyen sıkıştırma olabilir).');
                  }
                  var rgba = UTIF.toRGBA8(ifd);
                  var canvas = document.createElement('canvas');
                  canvas.width = ifd.width;
                  canvas.height = ifd.height;
                  var ctx = canvas.getContext('2d');
                  var imgData = ctx.createImageData(ifd.width, ifd.height);
                  imgData.data.set(rgba);
                  ctx.putImageData(imgData, 0, 0);
                  canvas = orientCanvas(canvas, ifd.t274 ? ifd.t274[0] : 1);
                  canvas = downscaleCanvas(canvas, preset.edge);
                  var p = canvasToBlob(canvas, 'image/jpeg', preset.q)
                    .then(function (b) { return b.arrayBuffer(); })
                    .then(function (ab) { return out.embedJpg(ab); });
                  return p.then(function (img) {
                    addImagePage(out, img, pageMode, 0);
                  });
                });
              });
              return pageChain;
            });
          });
        });
        return chain;
      }).then(function () {
        CA.setProgress(95, 'PDF oluşturuluyor…');
        return out.save();
      }).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        CA.hideProgress();
        var name = baseName(files[0].name) + '.pdf';
        CA.showResult(
          'TIFF dosyaları PDF\'e dönüştürüldü',
          out.getPageCount() + ' sayfa · ' + CA.formatBytes(blob.size),
          [{ label: 'PDF\'i İndir', blob: blob, name: name }]
        );
      });
    }));
  };

  /* --- PDF -> JPG/PNG --- */
  tools.pdf2img = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');

    function applyHashFormat() {
      if (location.hash !== '#png' && location.hash !== '#jpg') return;
      var want = location.hash === '#png' ? 'png' : 'jpeg';
      var row = $('#opt-format');
      CA.$$('.opt-choice', row).forEach(function (c) {
        c.classList.toggle('active', c.dataset.value === want);
      });
    }
    applyHashFormat();
    window.addEventListener('hashchange', applyHashFormat);

    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var fmt = CA.choiceValue('opt-format') || 'jpeg';
      var dpi = parseInt(CA.choiceValue('opt-dpi') || '150', 10);
      var scale = dpi / 72;
      var ext = fmt === 'png' ? 'png' : 'jpg';
      var mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      var base = baseName(file.name);
      var entries = [];

      CA.setProgress(0, 'PDF okunuyor…');
      return CA.readFile(file).then(function (buf) {
        return renderPdfPages(buf, scale, function (canvas, i, total) {
          return canvasToBlob(canvas, mime, 0.9).then(function (blob) {
            entries.push({ name: base + '_sayfa-' + pad(i, String(total).length) + '.' + ext, blob: blob });
          });
        }, 'Sayfalar görsele dönüştürülüyor');
      }).then(function (r) {
        if (entries.length === 1) {
          CA.hideProgress();
          CA.showResult(
            '1 sayfa ' + ext.toUpperCase() + ' olarak dönüştürüldü',
            dpi + ' DPI · ' + CA.formatBytes(entries[0].blob.size),
            [{ label: ext.toUpperCase() + ' İndir', blob: entries[0].blob, name: entries[0].name }]
          );
          return;
        }
        return zipBlobs(entries).then(function (zipBlob) {
          CA.hideProgress();
          CA.showResult(
            r.total + ' sayfa ' + ext.toUpperCase() + ' olarak dönüştürüldü',
            dpi + ' DPI · ZIP arşivi · ' + CA.formatBytes(zipBlob.size),
            [{ label: 'ZIP\'i İndir', blob: zipBlob, name: base + '_' + ext + '.zip' }]
          );
        });
      });
    }));
  };

  /* --- PDF Sıkıştır --- */
  tools.compress = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');
    var PRESETS = {
      dusuk: { scale: 1.0, q: 0.5 },
      orta: { scale: 1.5, q: 0.62 },
      yuksek: { scale: 2.0, q: 0.75 }
    };
    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var preset = PRESETS[CA.choiceValue('opt-quality') || 'orta'];
      var out;
      CA.setProgress(0, 'PDF okunuyor…');
      return PDFLib.PDFDocument.create().then(function (doc) {
        out = doc;
        return CA.readFile(file);
      }).then(function (buf) {
        return renderPdfPages(buf, preset.scale, function (canvas, i, total, pt) {
          return canvasToBlob(canvas, 'image/jpeg', preset.q)
            .then(function (b) { return b.arrayBuffer(); })
            .then(function (ab) { return out.embedJpg(ab); })
            .then(function (img) {
              var page = out.addPage([pt.w, pt.h]);
              page.drawImage(img, { x: 0, y: 0, width: pt.w, height: pt.h });
            });
        }, 'Sayfalar sıkıştırılıyor');
      }).then(function () {
        CA.setProgress(95, 'Dosya oluşturuluyor…');
        return out.save();
      }).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        CA.hideProgress();
        var saved = file.size - blob.size;
        var pct = Math.round((saved / file.size) * 100);
        var sub = CA.formatBytes(file.size) + ' → ' + CA.formatBytes(blob.size) +
          (saved > 0 ? ' (%' + pct + ' küçüldü)' : ' — dosya zaten optimize görünüyor');
        CA.showResult('Sıkıştırma tamamlandı', sub,
          [{ label: 'PDF\'i İndir', blob: blob, name: baseName(file.name) + '_sikistirilmis.pdf' }]);
      });
    }));
  };

  /* --- PDF Döndür --- */
  tools.rotate = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var delta = parseInt(CA.choiceValue('opt-angle') || '90', 10);
      var rangeStr = $('#ranges-input').value.trim();
      CA.setProgress(20, 'PDF okunuyor…');
      return CA.readFile(file)
        .then(function (buf) { return loadPdf(buf, file.name); })
        .then(function (doc) {
          var total = doc.getPageCount();
          var idxs;
          if (rangeStr) {
            idxs = CA.parseRanges(rangeStr, total);
            if (!idxs) throw new Error('Sayfa aralığı geçersiz. Örnek: 1-3, 5 (belge ' + total + ' sayfa). Tümü için boş bırakın.');
          } else {
            idxs = doc.getPageIndices();
          }
          CA.setProgress(60, 'Sayfalar döndürülüyor…');
          idxs.forEach(function (i) {
            var page = doc.getPage(i);
            var cur = page.getRotation().angle || 0;
            page.setRotation(PDFLib.degrees(((cur + delta) % 360 + 360) % 360));
          });
          CA.setProgress(85, 'Dosya oluşturuluyor…');
          return doc.save().then(function (bytes) {
            var blob = new Blob([bytes], { type: 'application/pdf' });
            CA.hideProgress();
            CA.showResult(
              idxs.length + ' sayfa ' + delta + '° döndürüldü',
              CA.formatBytes(blob.size),
              [{ label: 'PDF\'i İndir', blob: blob, name: baseName(file.name) + '_dondurulmus.pdf' }]
            );
          });
        });
    }));
  };

  /* --- Sayfa Sil --- */
  tools.removepages = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var rangeStr = $('#ranges-input').value.trim();
      if (!rangeStr) throw new Error('Silinecek sayfaları belirtin. Örnek: 2, 5-7');
      CA.setProgress(10, 'PDF okunuyor…');
      return CA.readFile(file)
        .then(function (buf) { return loadPdf(buf, file.name); })
        .then(function (src) {
          var total = src.getPageCount();
          var del = CA.parseRanges(rangeStr, total);
          if (!del) throw new Error('Sayfa aralığı geçersiz. Örnek: 2, 5-7 (belge ' + total + ' sayfa)');
          var delSet = {};
          del.forEach(function (i) { delSet[i] = true; });
          var keep = [];
          for (var i = 0; i < total; i++) if (!delSet[i]) keep.push(i);
          if (!keep.length) throw new Error('Tüm sayfaları silemezsiniz; en az bir sayfa kalmalı.');
          CA.setProgress(50, 'Sayfalar çıkarılıyor…');
          return PDFLib.PDFDocument.create().then(function (out) {
            return out.copyPages(src, keep).then(function (pages) {
              pages.forEach(function (p) { out.addPage(p); });
              CA.setProgress(85, 'Dosya oluşturuluyor…');
              return out.save();
            }).then(function (bytes) {
              var blob = new Blob([bytes], { type: 'application/pdf' });
              CA.hideProgress();
              CA.showResult(
                (total - keep.length) + ' sayfa silindi, ' + keep.length + ' sayfa kaldı',
                CA.formatBytes(blob.size),
                [{ label: 'PDF\'i İndir', blob: blob, name: baseName(file.name) + '_duzenlenmis.pdf' }]
              );
            });
          });
        });
    }));
  };

  /* --- Filigran --- */
  tools.watermark = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');
    var opSlider = $('#opacity-slider');
    var opVal = $('#opacity-val');
    opSlider.addEventListener('input', function () { opVal.textContent = '%' + opSlider.value; });

    var fontBytesPromise = null;
    function getFontBytes() {
      if (!fontBytesPromise) {
        fontBytesPromise = fetch('../assets/vendor/DejaVuSans-Bold.ttf')
          .then(function (r) {
            if (!r.ok) throw new Error('Font yüklenemedi.');
            return r.arrayBuffer();
          });
      }
      return fontBytesPromise;
    }

    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var text = ($('#wm-text').value || '').trim() || 'GİZLİDİR';
      var opacity = parseInt(opSlider.value, 10) / 100;
      var colorName = CA.choiceValue('opt-color') || 'gri';
      var color = colorName === 'kirmizi'
        ? PDFLib.rgb(0.76, 0.22, 0.16)
        : PDFLib.rgb(0.45, 0.45, 0.45);

      CA.setProgress(5, 'Font hazırlanıyor…');
      return Promise.all([CA.readFile(file), getFontBytes()]).then(function (res) {
        return loadPdf(res[0], file.name).then(function (doc) {
          doc.registerFontkit(fontkit);
          return doc.embedFont(res[1], { subset: true }).then(function (font) {
            var pages = doc.getPages();
            pages.forEach(function (page, i) {
              CA.setProgress(20 + (i / pages.length) * 65, 'Sayfa ' + (i + 1) + '/' + pages.length + ' işleniyor…');
              var box = visualBox(page);
              var vw = box.vw, vh = box.vh;
              var diag = Math.sqrt(vw * vw + vh * vh);
              var size = Math.max(20, Math.min(150, (diag * 0.75) / Math.max(1, text.length * 0.62)));
              var tw = font.widthOfTextAtSize(text, size);
              var rad = Math.atan2(vh, vw);
              var deg = rad * 180 / Math.PI;
              var vx = vw / 2 - (tw / 2) * Math.cos(rad) + (size * 0.35) * Math.sin(rad);
              var vy = vh / 2 - (tw / 2) * Math.sin(rad) - (size * 0.35) * Math.cos(rad);
              var pt = toPagePoint(box, vx, vy);
              page.drawText(text, {
                x: pt.x, y: pt.y, size: size, font: font,
                color: color, opacity: opacity,
                rotate: PDFLib.degrees(deg + box.rot)
              });
            });
            CA.setProgress(90, 'Dosya oluşturuluyor…');
            return doc.save();
          });
        });
      }).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        CA.hideProgress();
        CA.showResult(
          'Filigran tüm sayfalara eklendi',
          '"' + text + '" · ' + CA.formatBytes(blob.size),
          [{ label: 'PDF\'i İndir', blob: blob, name: baseName(file.name) + '_filigranli.pdf' }]
        );
      });
    }));
  };

  /* --- Sayfa Numarası --- */
  tools.pagenumbers = function () {
    var state = singleFileState(['.pdf'], null, pdfThumb);
    var btn = $('#run-btn');
    btn.addEventListener('click', runGuard(btn, function () {
      var file = state.require();
      var pos = CA.choiceValue('opt-pos') || 'alt-orta';
      var fmt = CA.choiceValue('opt-fmt') || 'n';
      var start = parseInt($('#start-input').value, 10);
      if (isNaN(start) || start < 0) start = 1;
      CA.setProgress(10, 'PDF okunuyor…');
      return CA.readFile(file)
        .then(function (buf) { return loadPdf(buf, file.name); })
        .then(function (doc) {
          return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
            var pages = doc.getPages();
            var totalLabel = start + pages.length - 1;
            pages.forEach(function (page, i) {
              CA.setProgress(20 + (i / pages.length) * 65, 'Sayfa ' + (i + 1) + '/' + pages.length + ' numaralanıyor…');
              var n = start + i;
              var label;
              if (fmt === 'n-of') label = n + ' / ' + totalLabel;
              else if (fmt === 'sayfa-n') label = 'Sayfa ' + n;
              else label = String(n);
              var size = 10;
              var tw = font.widthOfTextAtSize(label, size);
              var box = visualBox(page);
              var vx;
              if (pos === 'alt-sag') vx = box.vw - 42 - tw;
              else if (pos === 'alt-sol') vx = 42;
              else vx = (box.vw - tw) / 2;
              var pt = toPagePoint(box, vx, 26);
              page.drawText(label, {
                x: pt.x, y: pt.y, size: size, font: font,
                color: PDFLib.rgb(0.25, 0.25, 0.25),
                rotate: PDFLib.degrees(box.rot)
              });
            });
            CA.setProgress(90, 'Dosya oluşturuluyor…');
            return doc.save();
          });
        }).then(function (bytes) {
          var blob = new Blob([bytes], { type: 'application/pdf' });
          CA.hideProgress();
          CA.showResult(
            'Sayfa numaraları eklendi',
            CA.formatBytes(blob.size),
            [{ label: 'PDF\'i İndir', blob: blob, name: baseName(file.name) + '_numarali.pdf' }]
          );
        });
    }));
  };

  CA.initChoices();
  if (tools[tool]) tools[tool]();
})();
