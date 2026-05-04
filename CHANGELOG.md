# Changelog

Todos os ajustes notáveis do Optimize Toolkit. O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e usa versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [2.5.3] — 2026-05-03 (não publicada)

Reagrupamento de informação — "Páginas soltas" agora vive dentro de Protótipo.

### Mudou
- **G-01** Item "Páginas soltas" removido do menu home (antes era top-level junto com Componentes, Layers ocultas, Imagens e Protótipo).
- **G-02** Nova seção "Estrutura do arquivo" em `page-proto` com "Páginas soltas" como adv-item de navegação. Botão "Abrir" → `page-loose-pages`. Mantém a UX de seleção (checkboxes) e remoção em batch.
- **G-03** Back button de `page-loose-pages` agora vai para Protótipo em vez do home (origem coerente).
- **G-04** Badge de contagem de páginas soltas migrou do menu home para o adv-item em Protótipo (`.adv-item-count` — pill em Aeonik mono).

### Por quê
Antes Protótipo agrupava "interações + estrutura do fluxo + componentes + renderização + estrutura de nós". Páginas soltas, sendo gestão estrutural do arquivo, é da mesma família. Agrupar reduz o ruído do menu principal (4 itens em vez de 5) e cria coerência cognitiva: "tudo que mexe no protótipo está em Protótipo".

---

## [2.5.2] — 2026-05-03 (não publicada)

Polimento da página de Histórico alinhado ao Revolut Design System.

### Adicionado
- **H-02** 7 ícones SVG faltantes nas categorias (`triggers`, `scroll`, `vectors`, `singleGroups`, `deepNodes`, `covered`, `loosePages`). Antes caíam em texto solto (`↻ ↕ △ ⊟ ≡ ⬚ ▣`).
- **H-03** Tints semânticos de cor para todas as 14 categorias em light + dark theme (cyan, violet, amber, sky, fuchsia, lime, slate).
- **H-04** Summary card no topo da página de Histórico — agregados em Aeonik Pro (total de operações, KB liberados, ganho de score acumulado). Estilo extrato bancário Revolut.
- **H-05** Botão "Limpar histórico" no topbar com confirmação inline (primeiro clique pede confirmação, segundo clique limpa, reset automático em 4s).
- **H-06** Empty state polido — ícone SVG dentro de círculo de surface, headline em Aeonik 17/500, copy em Inter 12. Padrão Revolut.

### Mudou
- `_renderHistorySummary()` é chamado a cada `addHistory` e `_restoreHistory` para manter o card sempre atualizado.
- `_clearHistoryNow()` envia `save_history` com array vazio para zerar também o clientStorage.

---

## [2.5.1] — 2026-05-02 (não publicada)

Patch focado em persistência de histórico e troca do ícone do botão de Histórico.

### Corrigido
- **H-01** Histórico do extrato bancário agora **persiste entre sessões** via `figma.clientStorage` (TTL 30 dias, chave por `figma.root.id`). Antes ficava apenas em memória da UI e era perdido a cada fechamento do plugin. UI envia `save_history` a cada `addHistory`; `code.js` carrega no `ui_ready` e dispara `history_restore`.

### Mudou
- Ícone do botão Histórico no header trocado de "rotate-ccw" (seta de refresh, confundia com o botão "Novo scan") para o ícone "history" do Lucide (relógio com seta CCW — semântica clara de tempo + reversão).
- `addHistory` ganhou parâmetro opcional `_restoreTimestamp` para reconstruir entradas com data/hora originais.
- Score chips (`↑ Score X → Y +N pts`) agora persistem nos `extraData.scoreBefore/After` da entrada salva — após restore o chip mostra o impacto real da época, não recalcula com `_scoreData` stale.
- `aria-label="Histórico"` adicionado ao botão para acessibilidade.

### Adicionado
- `getHistoryKey()`, `saveHistory()`, `loadHistory()` em `code.js` — helpers para `figma.clientStorage` específicos de histórico.
- `_restoreHistory(entries)` em `ui.html` — limpa o painel e re-renderiza tudo em ordem cronológica.
- `_history` array em memória — snapshot serializável das entradas, hard-cap de 50 entradas.
- Handler de mensagem `history_restore` na UI.
- Handler de mensagem `save_history` em `code.js`.

### Compatibilidade
- 100% backward-compatible no protocolo de mensagens — apenas adiciona dois novos tipos de mensagem opcionais.
- Nenhuma feature visível foi removida; histórico antigo (em memória) continua funcionando exatamente igual durante a sessão.

---

## [2.5.0] — 2026-05-02 (não publicada)

Versão focada em performance percebida — sem mudanças no protocolo de mensagens nem em features visíveis para o usuário.

### Otimização (UX)
- **F-01** `detach_done`/`remove_done`/`remove_loose_pages_done` deixaram de re-escanear a página inteira após cada operação. Agora o cache é filtrado localmente por `_lastActionMode` (`'all'` vs `'selective'`) e a página é re-renderizada com a lista atualizada. **Ganho: ~50% menos tempo percebido por ação** — não há mais o segundo `findAll()` page-wide depois do detach/remove.
- **F-02** Plugin abre direto na `view-home` em vez de bloquear na `view-loading`. A estrutura da home (header + score bar + 5 itens de menu) aparece em < 50ms; badges começam como "—" e ganham valores quando o `scan_result` chega. **Ganho: tempo até primeiro pixel cai de 1-3s para < 50ms**.
- **F-03** Cache persistente via `figma.clientStorage` (TTL 1h, chave por `figma.root.id`). Re-aberturas no mesmo arquivo emitem o último resultado salvo imediatamente como `scan_result` com `fromCache: true`, enquanto um scan novo roda em background. UI distingue cache vs fresh para evitar baseline enganoso.

### Adicionado
- `_lastActionMode` (`'all'` | `'selective'`) — UI rastreia se a ação foi batch ou seletiva para decidir como atualizar o cache local sem re-scan.
- `_lastLooseRemovedIds` — preserva IDs entre `runRemoveLoosePages` e `remove_loose_pages_done` para filtragem local.
- `getCacheKey()`, `saveScanCache()`, `loadScanCache()` em `code.js` — helpers para `figma.clientStorage`.
- `runRemoveLoosePages` agora usa `view-progress` direto em vez de `view-loading` + `scan_loose_pages` no callback.

### Mudou
- `runAction`, `runDetachAll`, `runHiddenQuick`, `runRemoveLoosePages` setam `_lastActionMode` antes do `postMessage`.
- Handler de `scan_result` ramifica por `msg.fromCache`: cache atualiza score + badges + cache, mas pula `updateMem` e baseline; fresh faz tudo.
- Router de `code.js`: `ui_ready` resolve cache primeiro via callback antes de chamar `doScanInstances()`.

### Compatibilidade
- 100% backward-compatible no protocolo de mensagens — apenas adiciona o campo opcional `fromCache: true`.
- Nenhuma feature visível foi removida.
- Score pode ter +/- 1-2 pts de oscilação na primeira reabertura porque o cache mostra dados levemente desatualizados antes do fresh chegar (~1s).

---

## [2.4.0] — 2026-05-02 (não publicada)

Versão de fixes críticos e preparação para distribuição na Figma Community.

### Corrigido
- **B-01** Removido bloco `page-advanced` legado que duplicava 8 IDs (`res-flow-score`, `res-orphans`, `res-loops`, `res-triggers`, `res-overrides`, `res-scroll`, `res-effects`, `res-vectors`). `getElementById` retornava o elemento errado e o feedback dos scans avançados não aparecia para o usuário.
- **B-02** `doScanInstances` agora filtra apenas instâncias com `mainComponent.remote === true`, alinhando com a PRD seção 7.1. Antes contava todas as instâncias, penalizando arquivos com componentes locais legítimos.
- **B-03** `scoreStatus` alinhado com a PRD: faixas 80/60/35 (antes 85/65/40). Agora atingir a meta documentada da PRD ("≥ 80") rende o badge "Pronto".
- **B-04** Todas as operações destrutivas passam por `guardAndRun` no router central. Antes `remove_orphans`, `remove_covered`, `flatten_*` e `remove_loose_pages` (que remove páginas inteiras) podiam rodar em arquivos não elegíveis.
- **B-05** `HIST_CFG` ganhou 9 entries dedicadas (`effects`, `orphans`, `overrides`, `triggers`, `scroll`, `vectors`, `singleGroups`, `deepNodes`, `covered`, `loosePages`). Antes essas ações caíam em `detach`/`hidden`/`dissolve` e o histórico ficava ilegível depois de 3 ações.
- **B-06** Removido `setMode` legado que referenciava IDs inexistentes (`tab-comp`, `tab-hidden`, `view-proto`, `bottom-bar`).
- **B-07** Removido `updateCompSetBanner` (dead code do banner COMPONENT_SET descontinuado).
- **B-09** Removida referência a `figma.currentPage.name` no script da UI — `figma` global não existe no iframe.
- **B-10** `_cache['loose-pages']` declarado explicitamente no objeto inicial.
- **B-11** Penalidade de páginas alinhada com PRD: `> 3 ? 20 : > 2 ? 10 : 0` (antes `> 5 ? 20 : > 3 ? 10 : > 2 ? 5`).
- **B-12** `runHiddenQuick` reutiliza `_cache.hidden` quando válido, evitando re-scan de página inteira.
- **B-13** Removido `view-splash` markup morto (nunca era exibido — `showSplash` chamava o callback imediatamente).

### Adicionado
- `manifest.documentAccess: "dynamic-page"` — necessário para Figma 116+ em arquivos grandes.
- `manifest.networkAccess.allowedDomains` — declara fontes Google Fonts para passar pelo CSP do Figma.
- `README.md`, `CHANGELOG.md`, `LICENSE` (MIT), `.gitignore` — base para repositório público.
- `EVOLUTION_REPORT.md` — diagnóstico completo + roadmap até v3.0.

### Mudou
- Cabeçalhos de versão em `code.js` e `ui.html` documentam todas as mudanças.

### Compatibilidade
- 100% backward-compatible no protocolo de mensagens
- Nenhuma feature removida do usuário final
- Score de arquivos existentes pode mudar pequena (3-8 pontos) por causa do B-02/B-11 — esperado e correto

---

## [2.3.0] — 2026-04 (versão analisada)

### Adicionado
- Feature **Páginas soltas** — detecta e remove páginas sem frames de interface ou nome contextualizado
- 3 novas otimizações de estrutura de nós: grupos com filho único, nós com aninhamento excessivo, layers cobertas

### Mudou
- Score expandido para 7 dimensões (incluindo Interações)
- Histórico ganhou impacto no score automático em todas as ações

---

## [2.2.0]

### Adicionado
- Sistema de tema dark/light com `html.dark` como fonte de verdade
- Cache de resultados com invalidação seletiva por seção
- Empty state rico com métricas de antes/depois

---

## [2.1.0]

### Adicionado
- 7 novas otimizações: frames órfãos, overrides idênticos, triggers não-click, loops de navegação, scroll desnecessário, efeitos pesados, vetores complexos
- Score por fluxo ativo (BFS a partir de `flowStartingPoints`)
- Router único consolidado em `code.js` (substituiu encadeamento `_origOnMessage` que perdia mensagens)

---

## [2.0.0]

Refatoração de performance — `code.js` reduzido em ~40% de chamadas a `findAll()`.

### Mudou
- `scanPage` faz tudo em uma única traversal
- `mainComponent` acessado lazy (try/catch)
- `emitProgress` a cada 50 ops em vez de 10
- `checkGuardrails` agora é O(1)

---

## [1.0.0]

Versão inicial — 6 otimizações básicas: scan de instâncias, scan de hidden layers, detach seletivo, detach em lote, remoção de hidden, compressão de imagens.
