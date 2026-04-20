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

  var hiddenCount = page.findAll(function(n) { return n.visible === false; }).length;
  var mem = estimatePageSize(page);

  figma.ui.postMessage({
    type: 'scan_result',
    items: results,
    hiddenCount: hiddenCount,
    mem: mem
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
doScanInstances();

figma.ui.onmessage = function(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'scan')          doScanInstances();
  if (msg.type === 'scan_hidden')   doScanHidden();
  if (msg.type === 'detach')        doDetach(msg.ids);
  if (msg.type === 'remove_hidden') doRemoveHidden(msg.ids);
};
