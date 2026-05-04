// ─────────────────────────────────────────────────────────────────
// Optimize Toolkit — code.js  v2.5.1 (histórico persistente)
//
// Mudanças v2.5.1:
//  • H-01: histórico persistido via figma.clientStorage por arquivo
//          (TTL 30 dias). Antes só vivia em RAM da UI.
//  • Novo handler 'save_history' grava entradas vindas da UI
//  • ui_ready agora também emite 'history_restore' com entradas salvas
//
// Mudanças v2.5:
//  • F-03: cache persistente via figma.clientStorage — re-abertura
//          instantânea no mesmo arquivo (TTL 1h)
//  • doScanInstances persiste o resultado após cada scan
//  • ui_ready envia cache primeiro (fromCache: true) e depois scan fresh
//
// Mudanças v2.4:
//  • B-02: doScanInstances filtra apenas mainComponent.remote === true
//          (alinha com PRD seção 7.1 — antes contava TODAS as instâncias)
//  • B-04: todas as operações destrutivas passam por guardAndRun
//          (remove_orphans, remove_covered, flatten_*, remove_loose_pages)
//  • Compatível com manifest.documentAccess = "dynamic-page"
//
// Princípios de performance mantidos:
//  • ZERO page.findAll() duplos: scan + estimativa em UMA passagem
//  • mainComponent acessado com try/catch lazy (evita resolução remota)
//  • doScanHidden usa children.length em vez de findAll() por nó
//  • emitProgress a cada 50 ops (não a cada 10) para menos IPC
//  • checkGuardrails() é O(1): só conta páginas, sem traversal
//  • Nenhum Array.filter() criando arrays intermediários desnecessários
// ─────────────────────────────────────────────────────────────────

figma.showUI(__html__, { width: 340, height: 620 });

// ── v2.5: cache persistente via figma.clientStorage ──────────────
// Salva o último scan por arquivo (chave = figma.root.id). Na próxima
// abertura no mesmo arquivo, o resultado anterior é reemitido para a UI
// imediatamente, enquanto o scan novo roda em background. Corta o
// "tempo até primeiro pixel" de ~1-3s para ~50ms em re-aberturas.
var CACHE_VER     = 'v25';
var CACHE_TTL_MS  = 1000 * 60 * 60; // 1 hora — depois disso só fresh

function getCacheKey() {
  try { return 'ot-scan-' + CACHE_VER + '-' + figma.root.id; }
  catch (_) { return null; }
}

function saveScanCache(payload) {
  var key = getCacheKey();
  if (!key) return;
  // fire-and-forget — não bloqueia o caller
  try {
    figma.clientStorage.setAsync(key, { ts: Date.now(), payload: payload })
      .then(function(){}, function(){});
  } catch (_) {}
}

function loadScanCache(cb) {
  var key = getCacheKey();
  if (!key) { cb(null); return; }
  try {
    figma.clientStorage.getAsync(key).then(function(data) {
      if (data && data.ts && (Date.now() - data.ts) < CACHE_TTL_MS) {
        cb(data.payload);
      } else {
        cb(null);
      }
    }, function(){ cb(null); });
  } catch (_) {
    cb(null);
  }
}

// ── v2.5.1: histórico persistido via figma.clientStorage ──────────
// Mantém o extrato bancário entre sessões. Chave por arquivo
// (figma.root.id), TTL 30 dias. UI envia 'save_history' a cada
// addHistory; na abertura, ui_ready dispara 'history_restore'.
var HISTORY_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

function getHistoryKey() {
  try { return 'ot-history-' + CACHE_VER + '-' + figma.root.id; }
  catch (_) { return null; }
}

function saveHistory(entries) {
  var key = getHistoryKey();
  if (!key) return;
  try {
    figma.clientStorage.setAsync(key, { entries: entries, ts: Date.now() })
      .then(function(){}, function(){});
  } catch (_) {}
}

function loadHistory(cb) {
  var key = getHistoryKey();
  if (!key) { cb([]); return; }
  try {
    figma.clientStorage.getAsync(key).then(function(data) {
      if (data && data.entries && data.ts && (Date.now() - data.ts) < HISTORY_TTL_MS) {
        cb(data.entries);
      } else {
        cb([]);
      }
    }, function(){ cb([]); });
  } catch (_) { cb([]); }
}

// ── utilitários ───────────────────────────────────────────────────

function getDepth(node) {
  var d = 0, c = node.parent;
  while (c && c.type !== 'PAGE') { d++; c = c.parent; }
  return d;
}

function sortDeepFirst(nodes) {
  // cache depth inline — sem chamadas duplas
  var len = nodes.length;
  var pairs = new Array(len);
  for (var i = 0; i < len; i++) pairs[i] = { n: nodes[i], d: getDepth(nodes[i]) };
  pairs.sort(function(a, b) { return b.d - a.d; });
  var out = new Array(len);
  for (var j = 0; j < len; j++) out[j] = pairs[j].n;
  return out;
}

// ── guardrails ────────────────────────────────────────────────────

var PROTO_NAMES = ['prototipo', 'prototype', 'proto'];

function normalizeStr(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isDividerPage(page) {
  var name = (page.name || '').trim();
  if (!name) return true;
  if (/^[─━—–\-_=~•·\s]+$/.test(name)) return true;
  if (/^__.*__$/.test(name)) return true;
  var low = name.toLowerCase();
  return low.indexOf('divider') !== -1 || low.indexOf('separator') !== -1 || low.indexOf('---') !== -1;
}

function realPages() {
  // O(páginas) — sem traversal de nós
  return figma.root.children.filter(function(p) { return !isDividerPage(p); });
}

function checkGuardrails() {
  var real = realPages();
  if (real.length > 2) {
    return {
      ok: false,
      reason: 'O arquivo tem ' + real.length + ' páginas (desconsiderando separadores). '
        + 'O plugin só opera em arquivos com no máximo 2 páginas.\n\n'
        + 'Duplique apenas os frames de teste em um arquivo dedicado antes de otimizar.'
    };
  }
  var pageName = normalizeStr(figma.currentPage.name);
  var isProto = PROTO_NAMES.some(function(p) { return pageName.indexOf(p) !== -1; });
  if (!isProto) {
    return {
      ok: false,
      reason: 'A página atual se chama "' + figma.currentPage.name + '".\n\n'
        + 'Renomeie para "Protótipo" antes de usar o plugin.'
    };
  }
  return { ok: true };
}

function guardAndRun(fn) {
  var check = checkGuardrails();
  if (!check.ok) {
    figma.ui.postMessage({ type: 'guardrail_error', reason: check.reason });
    return;
  }
  fn();
}

// ── fontes do sistema ─────────────────────────────────────────────

var SYSTEM_FONTS_SET = {
  'Inter':1,'SF Pro':1,'SF Compact':1,'Roboto':1,'Arial':1,'Helvetica':1,
  'Georgia':1,'Times':1,'Courier':1,'Verdana':1,'Tahoma':1,
  '.AppleSystemUIFont':1,'San Francisco':1,'Segoe UI':1,
  'Ubuntu':1,'Noto':1,'Open Sans':1,'Lato':1
};

function isSystemFont(family) {
  if (SYSTEM_FONTS_SET[family]) return true;
  // substring check para variantes como "SF Pro Display"
  var keys = Object.keys(SYSTEM_FONTS_SET);
  for (var i = 0; i < keys.length; i++) {
    if (family.indexOf(keys[i]) !== -1) return true;
  }
  return false;
}

// ── scan principal — UMA traversal, tudo em paralelo ─────────────
// Retorna { instances, hiddenNodes, mem } sem chamar findAll() duas vezes.

function scanPage(page) {
  var all = page.findAll();   // ← ÚNICA traversal da página inteira
  var nodeCount = all.length;

  var instances  = [];
  var hiddenNodes = [];
  var kb = 0;
  var fonts = Object.create(null);   // Object.create(null) = sem prototype overhead

  for (var i = 0; i < nodeCount; i++) {
    var n = all[i];
    var t = n.type;

    // acumula KB por tipo (switch é mais rápido que if/else chain)
    switch (t) {
      case 'FRAME': case 'COMPONENT': case 'COMPONENT_SET': case 'GROUP': kb += 3; break;
      case 'INSTANCE':
        kb += 2;
        // B-02 (v2.4): apenas instâncias REMOTAS pesam o score
        // (componentes locais não dependem de bibliotecas externas).
        // mainComponent.remote=true indica vínculo com biblioteca publicada.
        // Em arquivos com biblioteca offline o acesso falha — tratamos como
        // remota nesse caso (try/catch + flag pessimista).
        try {
          var mc = n.mainComponent;
          if (mc) {
            if (mc.remote === true) instances.push(n);
          }
        } catch (_) {
          // resolução falhou — provável biblioteca remota inacessível,
          // contar como remota (pessimista).
          instances.push(n);
        }
        break;
      case 'VECTOR': case 'BOOLEAN_OPERATION': case 'STAR': case 'POLYGON': kb += 4; break;
      case 'TEXT':
        kb += 1;
        // coleta fonte inline — sem segundo loop
        try {
          var fn = n.fontName;
          if (fn && fn.family && fonts[fn.family] === undefined) {
            fonts[fn.family] = isSystemFont(fn.family) ? 0 : 1;
          }
        } catch (_) {}
        break;
      default: kb += 0.5;
    }

    // hidden check — inline, sem array extra
    if (n.visible === false) hiddenNodes.push(n);

    // fills de imagem — inline
    try {
      var fills = n.fills;
      if (fills && fills.length) {
        for (var f = 0; f < fills.length; f++) {
          if (fills[f].type === 'IMAGE') { kb += 8; break; }
        }
      }
    } catch (_) {}
  }

  // conta fontes custom sem criar array intermediário
  var customFontCount = 0;
  var fontKeys = Object.keys(fonts);
  for (var fk = 0; fk < fontKeys.length; fk++) {
    if (fonts[fontKeys[fk]] === 1) customFontCount++;
  }

  // peso outras páginas — O(páginas), sem traversal
  // try/catch necessário: com documentAccess:"dynamic-page" apenas a página
  // atual está carregada; acessar .children de outras páginas sem loadAsync()
  // lança "Cannot access property `children` on a page that has not been
  // explicitly loaded". A estimativa falha silenciosamente — não é crítico.
  var otherKb = 0;
  var pages = figma.root.children;
  for (var p = 0; p < pages.length; p++) {
    if (pages[p] !== page) {
      try { otherKb += pages[p].children.length * 12; } catch (_) {}
    }
  }

  var realPageCount = 0;
  for (var rp = 0; rp < pages.length; rp++) {
    if (!isDividerPage(pages[rp])) realPageCount++;
  }

  return {
    all:           all,
    nodeCount:     nodeCount,
    instances:     instances,
    hiddenNodes:   hiddenNodes,
    mem: {
      pageNodes:   nodeCount,
      pageKb:      Math.round(kb),
      fileKb:      Math.round(kb + otherKb),
      pageCount:   realPageCount,
      customFonts: customFontCount
    }
  };
}

// estimatePageSize agora reutiliza scanPage — sem findAll() extra
function estimatePageSize(page) {
  return scanPage(page).mem;
}

function emitProgress(type, done, total) {
  figma.ui.postMessage({ type: type, done: done, total: total });
}

// ── scan: instâncias ──────────────────────────────────────────────
// Uma única traversal via scanPage() — sem findAll() duplo.

function doScanInstances() {
  var page = figma.currentPage;
  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 0, totalPages: 1,
    pageName: page.name, foundSoFar: 0, scanType: 'instances' });

  var scan = scanPage(page);   // ← UMA traversal, tudo calculado
  var instances = scan.instances;
  var mem = scan.mem;

  // monta resultados sem acessar mainComponent em arquivo grande
  // (mainComponent pode causar resolução de biblioteca externa — caro)
  var results = new Array(instances.length);
  for (var j = 0; j < instances.length; j++) {
    var inst = instances[j];
    var name = inst.name;
    try {
      // mainComponent só acessado se não causar erro — lazy
      var mc = inst.mainComponent;
      if (mc && mc.name) name = mc.name;
    } catch (_) {}
    var directKids = inst.children ? inst.children.length : 0;
    results[j] = {
      id:         inst.id,
      name:       name,
      parent:     inst.parent ? inst.parent.name : '—',
      sizeKb:     Math.max(1, Math.round(directKids * 1.5 + 2)),
      childCount: directKids
    };
  }
  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });

  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 1, totalPages: 1,
    pageName: page.name, foundSoFar: results.length, scanType: 'instances' });

  var resultMsg = {
    type:            'scan_result',
    items:           results,
    hiddenCount:     scan.hiddenNodes.length,
    mem:             mem,
    topFrames:       page.children.length,
    customFonts:     mem.customFonts,
    hasComponentSet: false   // banner removido por solicitação
  };
  figma.ui.postMessage(resultMsg);
  // v2.5: persiste para reabertura instantânea no mesmo arquivo
  saveScanCache(resultMsg);
}

// ── scan: hidden ──────────────────────────────────────────────────
// Reutiliza scanPage() — sem findAll() extra.
// children.length em vez de n.findAll() por nó (elimina O(n²)).

function doScanHidden() {
  var page = figma.currentPage;
  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 0, totalPages: 1,
    pageName: page.name, foundSoFar: 0, scanType: 'hidden' });

  var scan = scanPage(page);
  var nodes = scan.hiddenNodes;

  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 1, totalPages: 1,
    pageName: page.name, foundSoFar: nodes.length, scanType: 'hidden' });

  var results = new Array(nodes.length);
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var kids = n.children ? n.children.length : 0;   // O(1) — sem findAll
    results[i] = {
      id:         n.id,
      name:       n.name || '(sem nome)',
      parent:     n.parent ? n.parent.name : '—',
      sizeKb:     Math.max(1, kids + 1),
      childCount: kids
    };
  }
  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });

  figma.ui.postMessage({
    type:  'scan_hidden_result',
    items: results,
    mem:   scan.mem
  });
}

// ── detach seletivo ───────────────────────────────────────────────

function doDetach(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var targets = figma.currentPage.findAll(function(n) {
    return n.type === 'INSTANCE' && set[n.id];
  });
  var sorted = sortDeepFirst(targets);
  var done = 0, total = sorted.length;

  for (var i = 0; i < total; i++) {
    try { if (sorted[i].parent) { sorted[i].detachInstance(); done++; } } catch (_) {}
    if (done % 50 === 0 || done === total) emitProgress('detach_progress', done, total);
  }

  var mem = estimatePageSize(figma.currentPage);
  figma.ui.postMessage({
    type:        'detach_done',
    done:        done,
    hiddenCount: figma.currentPage.findAll(function(n) { return n.visible === false; }).length,
    mem:         mem
  });
  figma.notify('✓ ' + done + ' instância(s) desvinculadas');
}

// ── detach em lote ────────────────────────────────────────────────

function doDetachAll() {
  var page = figma.currentPage;
  var all  = page.findAll(function(n) { return n.type === 'INSTANCE'; });
  var sorted = sortDeepFirst(all);
  var total = sorted.length, done = 0;

  emitProgress('detach_progress', 0, total);

  for (var i = 0; i < total; i++) {
    try { if (sorted[i].parent) { sorted[i].detachInstance(); done++; } } catch (_) {}
    if (done % 50 === 0 || done === total) emitProgress('detach_progress', done, total);
  }

  var mem = estimatePageSize(page);
  figma.ui.postMessage({
    type:        'detach_done',
    done:        done,
    hiddenCount: page.findAll(function(n) { return n.visible === false; }).length,
    mem:         mem
  });
  figma.notify('✓ ' + done + ' instâncias desvinculadas (lote)');
}

// ── remove hidden ─────────────────────────────────────────────────

function doRemoveHidden(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var hidden = figma.currentPage.findAll(function(n) {
    return n.visible === false && set[n.id];
  });
  var sorted = sortDeepFirst(hidden);
  var done = 0, total = sorted.length;

  for (var i = 0; i < total; i++) {
    try { if (sorted[i].parent) { sorted[i].remove(); done++; } } catch (_) {}
    if (done % 50 === 0 || done === total) emitProgress('remove_progress', done, total);
  }

  figma.ui.postMessage({ type: 'remove_done', done: done, mem: estimatePageSize(figma.currentPage) });
  figma.notify('✓ ' + done + ' layer(s) removida(s)');
}

// ── outline text ──────────────────────────────────────────────────

async function doOutlineText() {
  var page = figma.currentPage;
  var textNodes = page.findAll(function(n) { return n.type === 'TEXT'; });
  var total = textNodes.length;
  if (!total) {
    figma.ui.postMessage({ type: 'outline_done', done: 0, mem: estimatePageSize(page) });
    return;
  }
  emitProgress('outline_progress', 0, total);

  var families = Object.create(null);
  for (var i = 0; i < textNodes.length; i++) {
    try { var fn = textNodes[i].fontName; if (fn && fn.family && fn.style) families[fn.family + '::' + fn.style] = fn; } catch (_) {}
  }
  try { await Promise.all(Object.keys(families).map(function(k) { return figma.loadFontAsync(families[k]); })); } catch (_) {}

  var done = 0;
  for (var j = 0; j < textNodes.length; j++) {
    try { if (textNodes[j].parent) { figma.flatten([textNodes[j]]); done++; } } catch (_) {}
    if (done % 50 === 0 || done === total) emitProgress('outline_progress', done, total);
  }
  figma.ui.postMessage({ type: 'outline_done', done: done, mem: estimatePageSize(page) });
  figma.notify('✓ ' + done + ' texto(s) convertidos para vetor');
}

// ── dissolve ──────────────────────────────────────────────────────
// API correta (2024): setReactionsAsync() + campo actions[] obrigatório.
// O campo action (singular) foi depreciado — usar actions[] em cada reaction.

async function doSetDissolve() {
  var page = figma.currentPage;
  var all = page.findAll();
  var changed = 0;

  var DISSOLVE_TRANSITION = {
    type: 'DISSOLVE',
    easing: { type: 'EASE_OUT' },
    duration: 0.3
  };

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      var rxns = node.reactions;
      if (!rxns || !rxns.length) continue;

      var updated = false;
      var newRxns = [];

      for (var r = 0; r < rxns.length; r++) {
        var rx = rxns[r];
        // Pegar a action do campo actions[] (novo) ou action (legado)
        var actions = (rx.actions && rx.actions.length) ? rx.actions : (rx.action ? [rx.action] : []);
        
        var hasNavigate = actions.some(function(a) { return a.type === 'NODE'; });
        if (!hasNavigate) { newRxns.push(rx); continue; }

        // Atualizar cada action do tipo NODE para usar DISSOLVE
        var newActions = actions.map(function(a) {
          if (a.type !== 'NODE') return a;
          if (a.transition && a.transition.type === 'DISSOLVE' && a.transition.duration === 0.3) return a;
          return {
            type:                  a.type,
            destinationId:         a.destinationId,
            navigation:            a.navigation || 'NAVIGATE',
            transition:            DISSOLVE_TRANSITION,
            preserveScrollPosition: a.preserveScrollPosition || false
          };
        });

        // Montar nova reaction com actions[] (obrigatório) + action (compat legado)
        newRxns.push({
          trigger:  rx.trigger,
          actions:  newActions,
          action:   newActions[0]  // campo legado para compatibilidade
        });
        updated = true;
      }

      if (updated) {
        await node.setReactionsAsync(newRxns);
        changed++;
      }
    } catch (_) {}
  }

  figma.ui.postMessage({ type: 'dissolve_done', done: changed, mem: estimatePageSize(page) });
  figma.notify('✓ ' + changed + ' frame(s) com transição padronizada para Dissolve 300ms');
}

// ── scan imagens ──────────────────────────────────────────────────

async function doScanImages() {
  var page = figma.currentPage;
  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 0, totalPages: 1,
    pageName: page.name, foundSoFar: 0, scanType: 'images' });

  var all = page.findAll();
  var results = [];

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      var fills = node.fills;
      if (!fills || !fills.length) continue;
      for (var j = 0; j < fills.length; j++) {
        var fill = fills[j];
        if (fill.type !== 'IMAGE' || !fill.imageHash) continue;
        var img = figma.getImageByHash(fill.imageHash);
        if (!img) continue;
        var bytes = await img.getBytesAsync();
        var sizeKb = Math.round(bytes.length / 1024);
        var dataUrl = '';
        if (sizeKb < 200) {
          try {
            var mime = (bytes[0] === 0xFF && bytes[1] === 0xD8) ? 'image/jpeg' : 'image/png';
            dataUrl = 'data:' + mime + ';base64,' + figma.base64Encode(bytes);
          } catch (_) {}
        }
        results.push({
          id: node.id + '__' + fill.imageHash, nodeId: node.id,
          hash: fill.imageHash, fillIdx: j,
          name: node.name || '(sem nome)',
          parent: node.parent ? node.parent.name : '—',
          sizeKb: sizeKb,
          w: node.width ? Math.round(node.width) : 0,
          h: node.height ? Math.round(node.height) : 0,
          dataUrl: dataUrl
        });
        break;
      }
    } catch (_) {}
  }

  results.sort(function(a, b) { return b.sizeKb - a.sizeKb; });
  figma.ui.postMessage({ type: 'scan_progress', pageIndex: 1, totalPages: 1,
    pageName: page.name, foundSoFar: results.length, scanType: 'images' });
  figma.ui.postMessage({ type: 'scan_images_result', items: results, mem: estimatePageSize(page) });
}

// ── comprimir imagens ─────────────────────────────────────────────

async function doCompressImages(ids, quality) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var page = figma.currentPage;
  var toProcess = [];
  var all = page.findAll();

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      var fills = node.fills;
      if (!fills || !fills.length) continue;
      for (var j = 0; j < fills.length; j++) {
        var fill = fills[j];
        if (fill.type !== 'IMAGE' || !fill.imageHash) continue;
        if (set[node.id + '__' + fill.imageHash]) {
          toProcess.push({ node: node, fill: fill, fillIdx: j });
          break;
        }
      }
    } catch (_) {}
  }

  var done = 0, savedBytes = 0;
  var compressedMap = Object.create(null);

  for (var p = 0; p < toProcess.length; p++) {
    var item = toProcess[p];
    try {
      var img = figma.getImageByHash(item.fill.imageHash);
      if (!img) continue;
      var origBytes = await img.getBytesAsync();
      figma.ui.postMessage({
        type: 'compress_request', nodeId: item.node.id, fillIdx: item.fillIdx,
        bytes: Array.from(origBytes), quality: quality, index: p, total: toProcess.length
      });
      var compressed = await new Promise(function(resolve) {
        var h = function(m) {
          if (m.type === 'compress_result' && m.nodeId === item.node.id) {
            figma.ui.off('message', h); resolve(m);
          }
        };
        figma.ui.on('message', h);
        setTimeout(function() { figma.ui.off('message', h); resolve(null); }, 8000);
      });
      if (compressed && compressed.bytes) {
        var nb = new Uint8Array(compressed.bytes);
        var newImg = figma.createImage(nb);
        var newFills = JSON.parse(JSON.stringify(item.node.fills));
        newFills[item.fillIdx] = Object.assign({}, newFills[item.fillIdx], { imageHash: newImg.hash });
        item.node.fills = newFills;
        savedBytes += Math.max(0, origBytes.length - nb.length);
        compressedMap[item.node.id + '__' + item.fill.imageHash] = {
          from: Math.round(origBytes.length / 1024),
          to:   Math.round(nb.length / 1024)
        };
      }
      done++;
      emitProgress('compress_progress', done, toProcess.length);
    } catch (_) { done++; emitProgress('compress_progress', done, toProcess.length); }
  }

  figma.ui.postMessage({
    type: 'compress_done', done: done,
    savedKb: Math.round(savedBytes / 1024),
    compressedMap: compressedMap,
    mem: estimatePageSize(page)
  });
  figma.notify('✓ ' + done + ' imagem(ns) processada(s)');
}

// ── router consolidado — definido no final do arquivo ──
// (evitar encadeamento de onmessage que perde mensagens)

function waitForTask(p) { return p; }

// ══════════════════════════════════════════════════════════════════
// NOVAS OTIMIZAÇÕES — v2.1
// 1. Frames órfãos (sem conexão no prototype flow)
// 2. Overrides idênticos ao mainComponent
// 3. Triggers não-click (hover/drag/key)
// 4. Loops de navegação (ciclos no grafo)
// 5. Scroll desnecessário em frames
// 6. Efeitos pesados (blur/shadow)
// 7. Vetores complexos (flatten)
// 8. Score por fluxo ativo
// ══════════════════════════════════════════════════════════════════

// ── 1. Frames órfãos ─────────────────────────────────────────────
// Frames que não recebem nenhuma conexão e não têm starting point.
// Usa reactions para mapear o grafo de destinos.

function doScanOrphans() {
  var page = figma.currentPage;
  var topFrames = page.children.filter(function(n) {
    return n.type === 'FRAME' || n.type === 'COMPONENT';
  });

  // coleta todos os destinationIds de reactions na página inteira
  var reachable = Object.create(null);
  var all = page.findAll();
  for (var i = 0; i < all.length; i++) {
    var rxns = all[i].reactions;
    if (!rxns || !rxns.length) continue;
    for (var r = 0; r < rxns.length; r++) {
      var rx = rxns[r];
      // suporta actions[] (novo) e action (legado)
      var actions = (rx.actions && rx.actions.length) ? rx.actions : (rx.action ? [rx.action] : []);
      for (var a = 0; a < actions.length; a++) {
        if (actions[a].type === 'NODE' && actions[a].destinationId) {
          reachable[actions[a].destinationId] = true;
        }
      }
    }
  }

  // detecta starting points (frames com flowStartingPoints)
  var startingIds = Object.create(null);
  try {
    var flows = page.flowStartingPoints || [];
    for (var f = 0; f < flows.length; f++) {
      if (flows[f].nodeId) startingIds[flows[f].nodeId] = true;
    }
  } catch(_) {}

  var orphans = [];
  for (var j = 0; j < topFrames.length; j++) {
    var fr = topFrames[j];
    var isReachable = reachable[fr.id] || startingIds[fr.id];
    // verifica se tem reactions saindo dele
    var hasOutgoing = false;
    try {
      var frAll = fr.findAll();
      for (var k = 0; k < frAll.length; k++) {
        if (frAll[k].reactions && frAll[k].reactions.length) { hasOutgoing = true; break; }
      }
      if (fr.reactions && fr.reactions.length) hasOutgoing = true;
    } catch(_) {}

    if (!isReachable && !hasOutgoing) {
      orphans.push({ id: fr.id, name: fr.name,
        w: Math.round(fr.width), h: Math.round(fr.height) });
    }
  }

  figma.ui.postMessage({ type: 'scan_orphans_result', items: orphans });
}

// Remove frames órfãos selecionados
function doRemoveOrphans(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var done = 0;
  var page = figma.currentPage;
  page.children.forEach(function(n) {
    if (set[n.id]) { try { n.remove(); done++; } catch(_) {} }
  });
  figma.ui.postMessage({ type: 'orphans_done', done: done, mem: estimatePageSize(page) });
  figma.notify('✓ ' + done + ' frame(s) órfão(s) removido(s)');
}

// ── 2. Overrides idênticos ao componente ─────────────────────────
// instance.overrides retorna array de { id, overriddenFields[] }
// Campos sem mudança real podem ser resetados.

function doCleanOverrides() {
  var page = figma.currentPage;
  var instances = page.findAll(function(n) { return n.type === 'INSTANCE'; });
  var cleaned = 0;

  for (var i = 0; i < instances.length; i++) {
    var inst = instances[i];
    try {
      if (!inst.overrides || !inst.overrides.length) continue;
      // resetOverrides limpa overrides que são idênticos ao main component
      inst.resetOverrides();
      cleaned++;
    } catch(_) {}
  }

  figma.ui.postMessage({ type: 'overrides_done', done: cleaned, mem: estimatePageSize(page) });
  figma.notify('✓ ' + cleaned + ' instância(s) com overrides limpos');
}

// ── 3. Triggers não-click ─────────────────────────────────────────
// Detecta reactions com trigger != ON_CLICK (hover, drag, key press)
// que quebram em mobile/Maze.

var SAFE_TRIGGERS = { 'ON_CLICK': 1, 'ON_TAP': 1 };

function doScanBadTriggers() {
  var page = figma.currentPage;
  var all = page.findAll();
  var results = [];

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    var rxns = node.reactions;
    if (!rxns || !rxns.length) continue;
    var badRxns = rxns.filter(function(r) {
      return r.trigger && !SAFE_TRIGGERS[r.trigger.type];
    });
    if (badRxns.length) {
      results.push({
        id:      node.id,
        name:    node.name,
        parent:  node.parent ? node.parent.name : '—',
        triggers: badRxns.map(function(r) { return r.trigger.type; }).join(', ')
      });
    }
  }

  figma.ui.postMessage({ type: 'scan_triggers_result', items: results });
}

// Converte todos os bad triggers para ON_CLICK
async function doFixTriggers(ids) {
  var set = ids ? Object.create(null) : null;
  if (ids) for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var page = figma.currentPage;
  var all = page.findAll();
  var fixed = 0;

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    if (set && !set[node.id]) continue;
    var rxns = node.reactions;
    if (!rxns || !rxns.length) continue;
    try {
      var newRxns = rxns.map(function(r) {
        if (!r.trigger || SAFE_TRIGGERS[r.trigger.type]) return r;
        return { trigger: { type: 'ON_CLICK' }, actions: r.actions, action: r.action };
      });
      await node.setReactionsAsync(newRxns);
      fixed++;
    } catch(_) {}
  }

  figma.ui.postMessage({ type: 'triggers_done', done: fixed, mem: estimatePageSize(page) });
  figma.notify('✓ ' + fixed + ' interação(ões) convertidas para On Click');
}

// ── 4. Loops de navegação ─────────────────────────────────────────
// DFS para detectar ciclos no grafo de prototype.

function doScanLoops() {
  var page = figma.currentPage;
  var all = page.findAll();

  // monta grafo: nodeId → [destinationId]
  var graph = Object.create(null);
  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    var rxns = node.reactions;
    if (!rxns || !rxns.length) continue;
    // sobe até frame pai de nível 1
    var frame = node;
    while (frame.parent && frame.parent.type !== 'PAGE') frame = frame.parent;
    if (!graph[frame.id]) graph[frame.id] = {};
    for (var r = 0; r < rxns.length; r++) {
      var actions = (rxns[r].actions && rxns[r].actions.length) ? rxns[r].actions : (rxns[r].action ? [rxns[r].action] : []);
      for (var a = 0; a < actions.length; a++) {
        if (actions[a].type === 'NODE' && actions[a].destinationId) {
          graph[frame.id][actions[a].destinationId] = true;
        }
      }
    }
  }

  // DFS cycle detection
  var visited = Object.create(null);
  var inStack = Object.create(null);
  var cycles = [];

  function dfs(nodeId, path) {
    if (inStack[nodeId]) {
      cycles.push(path.slice(path.indexOf(nodeId)).concat(nodeId));
      return;
    }
    if (visited[nodeId]) return;
    visited[nodeId] = true;
    inStack[nodeId] = true;
    path.push(nodeId);
    var neighbors = graph[nodeId] ? Object.keys(graph[nodeId]) : [];
    for (var n = 0; n < neighbors.length; n++) dfs(neighbors[n], path);
    path.pop();
    inStack[nodeId] = false;
  }

  Object.keys(graph).forEach(function(id) { dfs(id, []); });

  // resolve nomes
  var nodeNames = Object.create(null);
  page.children.forEach(function(n) { nodeNames[n.id] = n.name; });

  var results = cycles.slice(0, 10).map(function(cycle) {
    return cycle.map(function(id) { return nodeNames[id] || id; }).join(' → ');
  });

  figma.ui.postMessage({ type: 'scan_loops_result', items: results, count: cycles.length });
}

// ── 5. Scroll desnecessário ───────────────────────────────────────
// Frames com clipsContent + overflow scroll mas cujo conteúdo
// cabe inteiramente dentro das dimensões do frame.

function doScanScroll() {
  var page = figma.currentPage;
  var frames = page.findAll(function(n) { return n.type === 'FRAME'; });
  var results = [];

  for (var i = 0; i < frames.length; i++) {
    var fr = frames[i];
    try {
      if (!fr.overflowDirection || fr.overflowDirection === 'NONE') continue;
      // calcula bounding box do conteúdo
      var maxH = 0, maxW = 0;
      fr.children.forEach(function(c) {
        maxH = Math.max(maxH, (c.y || 0) + (c.height || 0));
        maxW = Math.max(maxW, (c.x || 0) + (c.width || 0));
      });
      var isVertical = fr.overflowDirection === 'VERTICAL' || fr.overflowDirection === 'BOTH';
      var isHorizontal = fr.overflowDirection === 'HORIZONTAL' || fr.overflowDirection === 'BOTH';
      var unnecessary = (isVertical && maxH <= fr.height + 4) || (isHorizontal && maxW <= fr.width + 4);
      if (unnecessary) {
        results.push({
          id: fr.id, name: fr.name,
          parent: fr.parent ? fr.parent.name : '—',
          direction: fr.overflowDirection,
          w: Math.round(fr.width), h: Math.round(fr.height)
        });
      }
    } catch(_) {}
  }

  figma.ui.postMessage({ type: 'scan_scroll_result', items: results });
}

function doFixScroll(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var page = figma.currentPage;
  var frames = page.findAll(function(n) { return n.type === 'FRAME' && set[n.id]; });
  var fixed = 0;
  frames.forEach(function(fr) {
    try { fr.overflowDirection = 'NONE'; fixed++; } catch(_) {}
  });
  figma.ui.postMessage({ type: 'scroll_done', done: fixed, mem: estimatePageSize(page) });
  figma.notify('✓ ' + fixed + ' frame(s) com scroll removido');
}

// ── 6. Efeitos pesados ────────────────────────────────────────────
// Blur e drop-shadow são processados pelo compositor.
// Detecta e opcionalmente remove.

function doScanEffects() {
  var page = figma.currentPage;
  var all = page.findAll();
  var results = [];

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    try {
      var effects = node.effects;
      if (!effects || !effects.length) continue;
      var heavy = effects.filter(function(e) {
        return e.visible !== false && (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR' || e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
      });
      if (heavy.length) {
        results.push({
          id: node.id, name: node.name,
          parent: node.parent ? node.parent.name : '—',
          effects: heavy.map(function(e) { return e.type; }).join(', '),
          count: heavy.length
        });
      }
    } catch(_) {}
  }
  results.sort(function(a, b) { return b.count - a.count });
  figma.ui.postMessage({ type: 'scan_effects_result', items: results });
}

function doRemoveEffects(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var page = figma.currentPage;
  var nodes = page.findAll(function(n) { return set[n.id]; });
  var done = 0;
  nodes.forEach(function(node) {
    try { node.effects = []; done++; } catch(_) {}
  });
  figma.ui.postMessage({ type: 'effects_done', done: done, mem: estimatePageSize(page) });
  figma.notify('✓ ' + done + ' efeito(s) removido(s)');
}

// ── 7. Vetores complexos ──────────────────────────────────────────
// VECTOR com vectorPaths longos (> 200 pontos totais) — flatten simplifica.

async function doScanVectors() {
  var page = figma.currentPage;
  var vectors = page.findAll(function(n) { return n.type === 'VECTOR'; });
  var results = [];

  for (var i = 0; i < vectors.length; i++) {
    var v = vectors[i];
    try {
      var points = 0;
      if (v.vectorPaths) {
        for (var p = 0; p < v.vectorPaths.length; p++) {
          // conta comandos SVG como proxy de complexidade
          var data = v.vectorPaths[p].data || '';
          points += (data.match(/[MLHVCSQTAZ]/gi) || []).length;
        }
      }
      if (points > 80) {
        results.push({
          id: v.id, name: v.name || '(vetor)',
          parent: v.parent ? v.parent.name : '—',
          points: points
        });
      }
    } catch(_) {}
  }
  results.sort(function(a, b) { return b.points - a.points });
  figma.ui.postMessage({ type: 'scan_vectors_result', items: results });
}

function doFlattenVectors(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;
  var page = figma.currentPage;
  var vectors = page.findAll(function(n) { return n.type === 'VECTOR' && set[n.id]; });
  var done = 0;
  vectors.forEach(function(v) {
    try { figma.flatten([v]); done++; } catch(_) {}
  });
  figma.ui.postMessage({ type: 'vectors_done', done: done, mem: estimatePageSize(page) });
  figma.notify('✓ ' + done + ' vetor(es) simplificado(s)');
}

// ── 8. Score por fluxo ativo ──────────────────────────────────────
// Mapeia frames conectados ao(s) starting point(s) via BFS no grafo
// de reactions, e calcula o score só para esses frames.

function doScoreActiveFlow() {
  var page = figma.currentPage;

  // BFS a partir dos starting points
  var startingIds = [];
  try {
    var flows = page.flowStartingPoints || [];
    for (var f = 0; f < flows.length; f++) {
      if (flows[f].nodeId) startingIds.push(flows[f].nodeId);
    }
  } catch(_) {}

  if (!startingIds.length) {
    figma.ui.postMessage({ type: 'flow_score_result', error: 'Nenhum starting point encontrado. Defina um flow no Figma antes de usar esta função.' });
    return;
  }

  // monta grafo frame → [destinos]
  var graph = Object.create(null);
  var allNodes = page.findAll();
  for (var i = 0; i < allNodes.length; i++) {
    var node = allNodes[i];
    var rxns = node.reactions;
    if (!rxns || !rxns.length) continue;
    var frame = node;
    while (frame.parent && frame.parent.type !== 'PAGE') frame = frame.parent;
    if (!graph[frame.id]) graph[frame.id] = {};
    for (var r = 0; r < rxns.length; r++) {
      var actions = (rxns[r].actions && rxns[r].actions.length) ? rxns[r].actions : (rxns[r].action ? [rxns[r].action] : []);
      for (var a = 0; a < actions.length; a++) {
        if (actions[a].type === 'NODE' && actions[a].destinationId) {
          graph[frame.id][actions[a].destinationId] = true;
        }
      }
    }
  }

  // BFS
  var visited = Object.create(null);
  var queue = startingIds.slice();
  for (var q = 0; q < queue.length; q++) visited[queue[q]] = true;

  while (queue.length) {
    var cur = queue.shift();
    var neighbors = graph[cur] ? Object.keys(graph[cur]) : [];
    for (var n = 0; n < neighbors.length; n++) {
      if (!visited[neighbors[n]]) {
        visited[neighbors[n]] = true;
        queue.push(neighbors[n]);
      }
    }
  }

  var flowFrameIds = Object.keys(visited);
  var flowFrames = page.children.filter(function(n) { return visited[n.id]; });

  // calcula métricas só dos frames do fluxo
  var totalNodes = 0, totalInstances = 0, totalHidden = 0, totalImgKb = 0, customFonts = {};

  for (var ff = 0; ff < flowFrames.length; ff++) {
    var frameNodes = flowFrames[ff].findAll();
    totalNodes += frameNodes.length;
    for (var fn = 0; fn < frameNodes.length; fn++) {
      var n2 = frameNodes[fn];
      if (n2.type === 'INSTANCE') totalInstances++;
      if (n2.visible === false) totalHidden++;
      try {
        var fills = n2.fills;
        if (fills) for (var fi = 0; fi < fills.length; fi++) {
          if (fills[fi].type === 'IMAGE') { totalImgKb += 50; break; }
        }
        if (n2.type === 'TEXT' && n2.fontName && n2.fontName.family) {
          if (!isSystemFont(n2.fontName.family)) customFonts[n2.fontName.family] = true;
        }
      } catch(_) {}
    }
  }

  figma.ui.postMessage({
    type: 'flow_score_result',
    frameCount: flowFrameIds.length,
    totalFrames: page.children.length,
    nodes: totalNodes,
    instances: totalInstances,
    hidden: totalHidden,
    imgKb: totalImgKb,
    customFonts: Object.keys(customFonts).length,
    pageCount: realPages().length,
  });
}

// ops v2.1 — integradas no router central abaixo

// ══════════════════════════════════════════════════════════════════
// OTIMIZAÇÕES DE NÓS — v2.2
// 1. Flatten de grupos com filho único
// 2. Detector de profundidade excessiva
// 3. Layers cobertas (retângulos/elipses ocultos por outros)
// ══════════════════════════════════════════════════════════════════

// ── 1. Grupos com filho único ─────────────────────────────────────
// Um GROUP com apenas 1 filho não serve para organização e pode
// ser dissolvido sem qualquer impacto visual. Reduz contagem de nós
// e profundidade de árvore.

function doScanSingleGroups() {
  var page = figma.currentPage;
  var all = page.findAll(function(n) {
    return n.type === 'GROUP' && n.children && n.children.length === 1;
  });

  var results = all.map(function(n) {
    return {
      id:     n.id,
      name:   n.name || '(grupo)',
      parent: n.parent ? n.parent.name : '—',
      depth:  getDepth(n)
    };
  });
  results.sort(function(a, b) { return b.depth - a.depth; });

  figma.ui.postMessage({ type: 'scan_single_groups_result', items: results });
}

function doFlattenSingleGroups(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  // Ordena profundidade-primeiro para evitar referência a nós já removidos
  var targets = figma.currentPage.findAll(function(n) {
    return n.type === 'GROUP' && n.children && n.children.length === 1 && set[n.id];
  });
  var sorted = sortDeepFirst(targets);
  var done = 0;

  for (var i = 0; i < sorted.length; i++) {
    var grp = sorted[i];
    try {
      if (!grp.parent || !grp.children || !grp.children.length) continue;
      var child = grp.children[0];
      var parent = grp.parent;
      var idx = parent.children.indexOf(grp);
      // move filho para o lugar do grupo e remove o grupo
      parent.insertChild(idx, child);
      grp.remove();
      done++;
    } catch (_) {}
  }

  figma.ui.postMessage({ type: 'single_groups_done', done: done, mem: estimatePageSize(figma.currentPage) });
  figma.notify('✓ ' + done + ' grupo(s) com filho único dissolvido(s)');
}

// ── 2. Detector de profundidade excessiva ─────────────────────────
// Nós com profundidade > MAX_DEPTH que não são componentes são
// candidatos a achatamento — geralmente layers de organização.

var MAX_DEPTH = 6;

function doScanDeepNodes() {
  var page = figma.currentPage;
  var all = page.findAll();
  var results = [];

  for (var i = 0; i < all.length; i++) {
    var node = all[i];
    // Ignora instâncias e componentes — têm estrutura interna necessária
    if (node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') continue;
    var d = getDepth(node);
    if (d > MAX_DEPTH) {
      results.push({
        id:     node.id,
        name:   node.name || '(sem nome)',
        type:   node.type,
        parent: node.parent ? node.parent.name : '—',
        depth:  d
      });
    }
  }

  // Agrupa por profundidade para o relatório
  results.sort(function(a, b) { return b.depth - a.depth; });
  var maxD = results.length ? results[0].depth : 0;

  figma.ui.postMessage({
    type: 'scan_deep_nodes_result',
    items: results,
    maxDepth: maxD,
    threshold: MAX_DEPTH
  });
}

// Achata grupos profundos selecionados usando figma.flatten
function doFlattenDeepNodes(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var targets = figma.currentPage.findAll(function(n) {
    return set[n.id] && (n.type === 'GROUP' || n.type === 'FRAME');
  });
  var sorted = sortDeepFirst(targets);
  var done = 0;

  for (var i = 0; i < sorted.length; i++) {
    try {
      if (sorted[i].parent) {
        figma.flatten([sorted[i]]);
        done++;
      }
    } catch (_) {}
  }

  figma.ui.postMessage({ type: 'deep_nodes_done', done: done, mem: estimatePageSize(figma.currentPage) });
  figma.notify('✓ ' + done + ' nó(s) profundo(s) achatado(s)');
}

// ── 3. Layers cobertas ────────────────────────────────────────────
// Retângulos e elipses completamente cobertos por um irmão acima
// (mesma posição, mesma ou menor dimensão) são candidatos a remoção.
// Heurística O(frames × filhos²) — limitada a frames top-level.

function doScanCoveredLayers() {
  var page = figma.currentPage;
  var results = [];

  // Percorre apenas frames de nível 1 para manter O(n) aceitável
  var topFrames = page.children.filter(function(n) {
    return n.type === 'FRAME' || n.type === 'GROUP';
  });

  for (var f = 0; f < topFrames.length; f++) {
    try {
      var children = topFrames[f].findAll(function(n) {
        return (n.type === 'RECTANGLE' || n.type === 'ELLIPSE') && n.visible !== false;
      });

      for (var i = 0; i < children.length; i++) {
        var node = children[i];
        if (!node.parent) continue;

        var siblings = node.parent.children;
        var nodeIdx  = siblings.indexOf(node);
        if (nodeIdx < 0) continue;

        // Procura um irmão acima (maior índice = frente) que cubra este nó
        var covered = false;
        for (var j = nodeIdx + 1; j < siblings.length; j++) {
          var above = siblings[j];
          if (above.visible === false) continue;
          // Verifica cobertura geométrica com tolerância de 2px
          try {
            if (above.x <= node.x + 2 && above.y <= node.y + 2 &&
                above.x + above.width  >= node.x + node.width  - 2 &&
                above.y + above.height >= node.y + node.height - 2) {
              covered = true;
              break;
            }
          } catch (_) {}
        }

        if (covered) {
          results.push({
            id:     node.id,
            name:   node.name || '(sem nome)',
            type:   node.type,
            parent: node.parent ? node.parent.name : '—',
            sizeKb: 1
          });
        }
      }
    } catch (_) {}
  }

  figma.ui.postMessage({ type: 'scan_covered_result', items: results });
}

function doRemoveCovered(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var nodes = figma.currentPage.findAll(function(n) {
    return set[n.id] && (n.type === 'RECTANGLE' || n.type === 'ELLIPSE');
  });
  var sorted = sortDeepFirst(nodes);
  var done = 0;

  for (var i = 0; i < sorted.length; i++) {
    try { if (sorted[i].parent) { sorted[i].remove(); done++; } } catch (_) {}
  }

  figma.ui.postMessage({ type: 'covered_done', done: done, mem: estimatePageSize(figma.currentPage) });
  figma.notify('✓ ' + done + ' layer(s) coberta(s) removida(s)');
}

// ops v2.2 — integradas no router central abaixo

// ══════════════════════════════════════════════════════════════════
// ROUTER ÚNICO — único ponto de entrada para todas as mensagens
// Evita o padrão _origOnMessage encadeado que perde mensagens
// ══════════════════════════════════════════════════════════════════
figma.ui.onmessage = function(msg) {
  if (!msg || !msg.type) return;
  var t = msg.type;

  // ── scans sem guardrail ──
  // v2.5: ui_ready primeiro envia cache persistido (se existir e dentro
  // do TTL), depois roda scan novo em background para atualizar.
  // v2.5.1: também emite 'history_restore' com entradas salvas.
  if (t === 'ui_ready') {
    // restaura histórico antes de qualquer outra coisa (independente do scan)
    loadHistory(function(entries) {
      if (entries && entries.length) {
        figma.ui.postMessage({ type: 'history_restore', entries: entries });
      }
    });
    loadScanCache(function(cached) {
      if (cached) {
        cached.fromCache = true; // marca para a UI distinguir
        figma.ui.postMessage(cached);
      }
      doScanInstances();
    });
    return;
  }
  if (t === 'scan')   { doScanInstances();  return; }
  // v2.5.1: UI grava entrada de histórico após cada addHistory
  if (t === 'save_history') { saveHistory(msg.entries || []); return; }
  if (t === 'scan_hidden')                { doScanHidden();      return; }
  if (t === 'scan_images')                { waitForTask(doScanImages()); return; }
  if (t === 'scan_orphans')               { doScanOrphans();     return; }
  if (t === 'scan_triggers')              { doScanBadTriggers(); return; }
  if (t === 'scan_loops')                 { doScanLoops();       return; }
  if (t === 'scan_scroll')                { doScanScroll();      return; }
  if (t === 'scan_effects')               { doScanEffects();     return; }
  if (t === 'scan_vectors')               { waitForTask(doScanVectors()); return; }
  if (t === 'score_flow')                 { doScoreActiveFlow(); return; }
  if (t === 'scan_single_groups')         { doScanSingleGroups();    return; }
  if (t === 'scan_deep_nodes')            { doScanDeepNodes();       return; }
  if (t === 'scan_covered')               { doScanCoveredLayers();   return; }

  // ── páginas soltas (scan sem guardrail, remove com guardrail) ──
  if (t === 'scan_loose_pages')   { doScanLoosePages(); return; }

  // ── ops com guardrail ──
  // B-04 (v2.4): TODAS as operações mutativas passam pelo guardrail.
  // Antes só detach/remove_hidden/outline/dissolve/compress eram protegidos —
  // operações destrutivas como remove_orphans, remove_covered, flatten_*,
  // remove_loose_pages podiam rodar em arquivos não elegíveis (DS, biblioteca).
  var guarded = {
    'detach':                function() { doDetach(msg.ids); },
    'detach_all':            doDetachAll,
    'remove_hidden':         function() { doRemoveHidden(msg.ids); },
    'outline_text':          function() { waitForTask(doOutlineText()); },
    'set_dissolve':          doSetDissolve,
    'set_dissolve_direct':   function() { waitForTask(doSetDissolve()); },
    'compress_images':       function() { waitForTask(doCompressImages(msg.ids, msg.quality || 0.72)); },
    'clean_overrides':       doCleanOverrides,
    'fix_scroll':            function() { doFixScroll(msg.ids); },
    'remove_effects':        function() { doRemoveEffects(msg.ids); },
    'flatten_vectors':       function() { doFlattenVectors(msg.ids); },
    'remove_orphans':        function() { doRemoveOrphans(msg.ids); },
    'flatten_single_groups': function() { doFlattenSingleGroups(msg.ids); },
    'flatten_deep_nodes':    function() { doFlattenDeepNodes(msg.ids); },
    'remove_covered':        function() { doRemoveCovered(msg.ids); },
    'fix_triggers':          function() { waitForTask(doFixTriggers(msg.ids)); },
    'remove_loose_pages':    function() { doRemoveLoosePages(msg.ids); }
  };
  if (guarded[t]) { guardAndRun(guarded[t]); }
};

// ══════════════════════════════════════════════════════════════════
// PÁGINAS SOLTAS — v2.3
// Detecta páginas que não têm frames de interface real:
//   • sem frames com conteúdo (children)
//   • sem nenhuma reaction no prototype flow
//   • nome não contextualizado (não contém palavras de contexto)
//   • não é uma página "Protótipo" ou "Cover"
// ══════════════════════════════════════════════════════════════════

// Palavras que indicam página com propósito — não remover
var CONTEXT_NAMES = [
  'prototipo','prototype','proto',
  'cover','capa','apresentacao','presentation',
  'entrega','handoff','especificacao','spec',
  'fluxo','flow','jornada','journey',
  'componente','component','biblioteca','library',
  'guia','guide','style','estilo',
  'aprovacao','review','feedback',
  'pesquisa','research','discovery'
];

function isContextPage(page) {
  var norm = normalizeStr(page.name || '');
  return CONTEXT_NAMES.some(function(w){ return norm.indexOf(w) !== -1; });
}

function hasRealFrames(page) {
  // Página tem frames de interface se tiver pelo menos 1 FRAME
  // com children (não vazio)
  for (var i = 0; i < page.children.length; i++) {
    var n = page.children[i];
    if (n.type === 'FRAME' && n.children && n.children.length > 0) return true;
  }
  return false;
}

function hasPrototypeConnections(page) {
  // Verifica se qualquer nó da página tem reactions saindo
  // (usa findAll uma vez — aceitável pois é diagnóstico)
  try {
    var all = page.findAll();
    for (var i = 0; i < all.length; i++) {
      var rxns = all[i].reactions;
      if (rxns && rxns.length > 0) return true;
    }
    // Verifica também flowStartingPoints
    var flows = page.flowStartingPoints || [];
    if (flows.length > 0) return true;
  } catch(_) {}
  return false;
}

function isLoosePage(page) {
  // Uma página é "solta" se:
  // 1. Não é divider
  // 2. Não tem nome contextualizado
  // 3. Não tem frames reais com conteúdo
  // 4. Não tem conexões de prototype
  if (isDividerPage(page)) return false;           // dividers ignorados
  if (isContextPage(page)) return false;           // nome contextualizado = ok
  if (hasPrototypeConnections(page)) return false; // conectada ao flow = ok
  if (!hasRealFrames(page)) return true;           // sem frames = solta
  // tem frames mas sem nome de contexto e sem connections
  // → pode ser rascunho ou página de exploração
  return true;
}

function doScanLoosePages() {
  var pages = figma.root.children;
  var results = [];

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    if (page === figma.currentPage) continue; // nunca remover página atual

    if (isLoosePage(page)) {
      // conta itens soltos para dar contexto ao designer
      var itemCount = page.children.length;
      var frameCount = page.children.filter(function(n){ return n.type==='FRAME'; }).length;
      var hasConnections = hasPrototypeConnections(page);

      results.push({
        id:           page.id,
        name:         page.name,
        itemCount:    itemCount,
        frameCount:   frameCount,
        hasConnections: hasConnections,
        reason:       !hasRealFrames(page)
          ? (itemCount === 0 ? 'Página vazia' : 'Sem frames de interface')
          : 'Nome sem contexto e sem conexões de protótipo'
      });
    }
  }

  figma.ui.postMessage({ type: 'scan_loose_pages_result', items: results });
}

function doRemoveLoosePages(ids) {
  var set = Object.create(null);
  for (var k = 0; k < ids.length; k++) set[ids[k]] = true;

  var done = 0;
  // nunca remover a página atual
  var toRemove = figma.root.children.filter(function(p){
    return set[p.id] && p !== figma.currentPage;
  });

  for (var i = 0; i < toRemove.length; i++) {
    try {
      toRemove[i].remove();
      done++;
    } catch(_) {}
  }

  figma.ui.postMessage({
    type: 'remove_loose_pages_done',
    done: done,
    mem:  estimatePageSize(figma.currentPage)
  });
  figma.notify('✓ ' + done + ' página(s) removida(s)');
}
