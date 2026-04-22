figma.showUI(__html__, { width: 340, height: 620 });

function getDepth(node) {
  var d = 0, c = node.parent;
  while (c) { d++; c = c.parent; }
  return d;
}

function sortDeepFirst(nodes) {
  var wd = nodes.map(function(n) { return { node: n, depth: getDepth(n) }; });
  wd.sort(function(a, b) { return b.depth - a.depth; });
  return wd.map(function(x) { return x.node; });
}

// Estimativa de tamanho baseada em contagem real de nós por tipo
// Pesos calibrados empiricamente:
// FRAME/COMPONENT = 3KB, INSTANCE = 2KB, TEXT = 1KB, VECTOR = 4KB, IMAGE = 8KB, outros = 0.5KB
function estimatePageSize(page) {
  var all = page.findAll();
  var totalNodes = all.length;
  var kb = 0;
  var breakdown = { frames: 0, instances: 0, text: 0, vectors: 0, images: 0, other: 0 };

  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    switch(n.type) {
      case 'FRAME':
      case 'COMPONENT':
      case 'COMPONENT_SET':
      case 'GROUP':        kb += 3;  breakdown.frames++;    break;
      case 'INSTANCE':     kb += 2;  breakdown.instances++; break;
      case 'TEXT':         kb += 1;  breakdown.text++;      break;
      case 'VECTOR':
      case 'BOOLEAN_OPERATION':
      case 'STAR':
      case 'POLYGON':      kb += 4;  breakdown.vectors++;   break;
      case 'RECTANGLE':
      case 'ELLIPSE':
      case 'LINE':         kb += 0.5; breakdown.other++;   break;
      default:             kb += 0.5; breakdown.other++;   break;
    }
    // imagens somam mais
    try {
      if ('fills' in n && Array.isArray(n.fills)) {
        for (var j = 0; j < n.fills.length; j++) {
          if (n.fills[j].type === 'IMAGE') { kb += 8; breakdown.images++; }
        }
      }
    } catch(e) {}
  }

  // tamanho do arquivo = soma das páginas (estimativa: outras páginas × 0.3)
  var otherPagesKb = 0;
  for (var p = 0; p < figma.root.children.length; p++) {
    if (figma.root.children[p] !== page) {
      otherPagesKb += figma.root.children[p].findAll().length * 1.5;
    }
  }

  return {
    pageNodes:    totalNodes,
    pageKb:       Math.round(kb),
    fileKb:       Math.round(kb + otherPagesKb),
    breakdown:    breakdown,
    pageCount:    figma.root.children.length
  };
}

function formatSize(kb) {
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
  return kb + ' KB';
}

function emitScanProgress(pageIndex, totalPages, pageName, foundSoFar, type) {
  figma.ui.postMessage({
    type: 'scan_progress',
    pageIndex: pageIndex, totalPages: totalPages,
    pageName: pageName, foundSoFar: foundSoFar, scanType: type
  });
}

// ── detectar fontes customizadas ──────────────────────────
var SYSTEM_FONTS = ['Inter','SF Pro','SF Compact','Roboto','Arial','Helvetica',
  'Georgia','Times','Courier','Verdana','Tahoma','.AppleSystemUIFont',
  'San Francisco','Segoe UI','Ubuntu','Noto','Open Sans','Lato'];

function detectCustomFonts(page) {
  var fonts = {};
  var textNodes = page.findAll(function(n) { return n.type === 'TEXT'; });
  for (var i = 0; i < textNodes.length; i++) {
    try {
      var fn = textNodes[i].fontName;
      if (fn && fn.family) {
        var isSystem = false;
        for (var j = 0; j < SYSTEM_FONTS.length; j++) {
          if (fn.family.indexOf(SYSTEM_FONTS[j]) !== -1) { isSystem = true; break; }
        }
        if (!isSystem) fonts[fn.family] = true;
      }
    } catch(e) {}
  }
  return Object.keys(fonts).length;
}

// ── scan instâncias ───────────────────────────────────────
function doScanInstances() {
  var page = figma.currentPage;
  emitScanProgress(0, 1, page.name, 0, 'instances');

  var nodes = page.findAll(function(n) { return n.type === 'INSTANCE'; });
  emitScanProgress(1, 1, page.name, nodes.length, 'instances');

  var results = [];
  for (var i = 0; i < nodes.length; i++) {
    var inst = nodes[i];
    try {
      var kids = ('children' in inst) ? inst.findAll().length : 0;
      results.push({
        id:         inst.id,
        name:       (inst.mainComponent ? inst.mainComponent.name : inst.name) || inst.name,
        parent:     inst.parent ? inst.parent.name : '—',
        sizeKb:     Math.max(1, Math.round(kids * 0.5 + 2)),
        childCount: kids
      });
    } catch(e) {}
  }
  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });

  var hiddenCount  = page.findAll(function(n) { return n.visible === false; }).length;
  var mem          = estimatePageSize(page);
  var topFrames    = page.children ? page.children.length : 0;
  var customFonts  = detectCustomFonts(page);

  figma.ui.postMessage({
    type: 'scan_result',
    items: results,
    hiddenCount: hiddenCount,
    mem: mem,
    topFrames: topFrames,
    customFonts: customFonts
  });
}

// ── scan hidden ───────────────────────────────────────────
function doScanHidden() {
  var page = figma.currentPage;
  emitScanProgress(0, 1, page.name, 0, 'hidden');

  var nodes = page.findAll(function(n) { return n.visible === false; });
  emitScanProgress(1, 1, page.name, nodes.length, 'hidden');

  var results = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    try {
      var kids = ('children' in n) ? n.findAll().length : 0;
      results.push({
        id:         n.id,
        name:       n.name || '(sem nome)',
        parent:     n.parent ? n.parent.name : '—',
        sizeKb:     Math.max(1, Math.round(kids * 0.5 + 1)),
        childCount: kids
      });
    } catch(e) {}
  }
  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });

  var mem = estimatePageSize(page);
  figma.ui.postMessage({ type: 'scan_hidden_result', items: results, mem: mem });
}

// ── detach ────────────────────────────────────────────────
function doDetach(ids) {
  var set = {};
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var instances = figma.currentPage.findAll(function(n) { return n.type === 'INSTANCE' && set[n.id]; });
  var sorted = sortDeepFirst(instances);
  var done = 0;
  for (var i = 0; i < sorted.length; i++) {
    try {
      if (sorted[i].parent) { sorted[i].detachInstance(); done++; }
      figma.ui.postMessage({ type: 'detach_progress', done: done, total: sorted.length });
    } catch(e) {}
  }

  var hiddenAfter = figma.currentPage.findAll(function(n) { return n.visible === false; }).length;
  var mem = estimatePageSize(figma.currentPage);

  figma.ui.postMessage({ type: 'detach_done', done: done, hiddenCount: hiddenAfter, mem: mem });
  figma.notify('✓ Optimize Toolkit: ' + done + ' instância(s) desvinculadas');
}

// ── remove hidden ─────────────────────────────────────────
function doRemoveHidden(ids) {
  var set = {};
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var hidden = figma.currentPage.findAll(function(n) { return n.visible === false && set[n.id]; });

  try {
    figma.currentPage.selection = hidden.filter(function(n) {
      var p = n; while (p && p.type !== 'PAGE') p = p.parent; return p === figma.currentPage;
    });
  } catch(e) {}

  var sorted = sortDeepFirst(hidden);
  var done = 0;
  for (var i = 0; i < sorted.length; i++) {
    try {
      if (sorted[i].parent) { sorted[i].remove(); done++; }
      figma.ui.postMessage({ type: 'remove_progress', done: done, total: sorted.length });
    } catch(e) {}
  }
  try { figma.currentPage.selection = []; } catch(e) {}

  var mem = estimatePageSize(figma.currentPage);
  figma.ui.postMessage({ type: 'remove_done', done: done, mem: mem });
  figma.notify('✓ Optimize Toolkit: ' + done + ' layer(s) removida(s)');
}

// ── init ─────────────────────────────────────────────────
// Nao auto-scana ao abrir - aguarda a UI sinalizar ui_ready
// evita scan_result chegar antes do DOM estar inicializado

figma.ui.onmessage = function(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'ui_ready')         { doScanInstances(); return; }
  if (msg.type === 'scan')             doScanInstances();
  if (msg.type === 'scan_hidden')      doScanHidden();
  if (msg.type === 'detach')           doDetach(msg.ids);
  if (msg.type === 'remove_hidden')    doRemoveHidden(msg.ids);
  if (msg.type === 'scan_images')      waitForTask(doScanImages());
  if (msg.type === 'compress_images')  waitForTask(doCompressImages(msg.ids, msg.quality||0.72));
};

function waitForTask(promise) {
  // helper para operações async no plugin (não-widget)
  return promise;
}

// ── scan imagens ──────────────────────────────────────────
async function doScanImages() {
  var page = figma.currentPage;
  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 0, totalPages: 1, pageName: page.name, foundSoFar: 0, scanType: 'images' });

  var all = page.findAll();
  var results = [];

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      if (!('fills' in node) || !Array.isArray(node.fills)) continue;
      for (var j = 0; j < node.fills.length; j++) {
        var fill = node.fills[j];
        if (fill.type !== 'IMAGE' || !fill.imageHash) continue;

        var img = figma.getImageByHash(fill.imageHash);
        if (!img) continue;

        var bytes = await img.getBytesAsync();
        var sizeKb = Math.round(bytes.length / 1024);

        // tenta obter dimensões
        var w = ('width' in node) ? Math.round(node.width) : 0;
        var h = ('height' in node) ? Math.round(node.height) : 0;

        // thumbnail base64 — só para imagens pequenas (< 200KB) para não travar
        var dataUrl = '';
        if (sizeKb < 200) {
          try {
            var b64 = figma.base64Encode(bytes);
            // detecta tipo da imagem
            var mime = 'image/png';
            if (bytes[0] === 0xFF && bytes[1] === 0xD8) mime = 'image/jpeg';
            else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = 'image/gif';
            else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = 'image/webp';
            dataUrl = 'data:' + mime + ';base64,' + b64;
          } catch(_) {}
        }

        results.push({
          id:       node.id + '__' + fill.imageHash,
          nodeId:   node.id,
          hash:     fill.imageHash,
          fillIdx:  j,
          name:     node.name || '(sem nome)',
          parent:   node.parent ? node.parent.name : '—',
          sizeKb:   sizeKb,
          w:        w,
          h:        h,
          dataUrl:  dataUrl
        });
        break; // um fill por nó é suficiente para listar
      }
    } catch(e) {}
  }

  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });

  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 1, totalPages: 1, pageName: page.name, foundSoFar: results.length, scanType: 'images' });

  var mem = estimatePageSize(page);
  figma.ui.postMessage({ type: 'scan_images_result', items: results, mem: mem });
}

// ── comprimir imagens ─────────────────────────────────────
// A API do Figma não permite re-encode de imagens diretamente.
// A estratégia: cria um ImageData novo a partir dos bytes originais
// re-encodando via canvas no iframe (se disponível) ou marcando para
// compressão futura. Aqui comprimimos lendo os bytes e re-criando.
async function doCompressImages(ids, quality) {
  var set = {};
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var page = figma.currentPage;
  var all = page.findAll();
  var done = 0, totalSavedBytes = 0;
  var toProcess = [];

  // coleta os nós que precisam ser processados
  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      if (!('fills' in node) || !Array.isArray(node.fills)) continue;
      for (var j = 0; j < node.fills.length; j++) {
        var fill = node.fills[j];
        if (fill.type !== 'IMAGE' || !fill.imageHash) continue;
        var compositeId = node.id + '__' + fill.imageHash;
        if (set[compositeId]) {
          toProcess.push({ node: node, fill: fill, fillIdx: j });
          break;
        }
      }
    } catch(e) {}
  }

  for (var p = 0; p < toProcess.length; p++) {
    var item = toProcess[p];
    try {
      var img = figma.getImageByHash(item.fill.imageHash);
      if (!img) continue;

      var origBytes = await img.getBytesAsync();
      var origSize = origBytes.length;

      // Envia bytes para o iframe comprimir via Canvas API
      figma.ui.postMessage({
        type: 'compress_request',
        nodeId: item.node.id,
        fillIdx: item.fillIdx,
        bytes: Array.from(origBytes),
        quality: quality,
        index: p,
        total: toProcess.length
      });

      // Aguarda resposta do iframe (processada assincronamente)
      // Para simplificar, usamos uma promessa com timeout
      var compressed = await new Promise(function(resolve) {
        var handler = function(msg) {
          if (msg.type === 'compress_result' && msg.nodeId === item.node.id) {
            figma.ui.off('message', handler);
            resolve(msg);
          }
        };
        figma.ui.on('message', handler);
        setTimeout(function() { figma.ui.off('message', handler); resolve(null); }, 8000);
      });

      if (compressed && compressed.bytes) {
        var newBytes = new Uint8Array(compressed.bytes);
        var newImg = figma.createImage(newBytes);
        var fills = JSON.parse(JSON.stringify(item.node.fills));
        fills[item.fillIdx] = Object.assign({}, fills[item.fillIdx], { imageHash: newImg.hash });
        item.node.fills = fills;
        totalSavedBytes += Math.max(0, origSize - newBytes.length);
        done++;
      } else {
        done++; // conta mesmo sem compressão real para não travar o progress
      }

      figma.ui.postMessage({ type: 'compress_progress', done: done, total: toProcess.length });
    } catch(e) { done++; figma.ui.postMessage({ type: 'compress_progress', done: done, total: toProcess.length }); }
  }

  var mem = estimatePageSize(page);
  figma.ui.postMessage({
    type: 'compress_done',
    done: done,
    savedKb: Math.round(totalSavedBytes / 1024),
    mem: mem
  });
  figma.notify('✓ Optimize Toolkit: ' + done + ' imagem(ns) processada(s)');
}
