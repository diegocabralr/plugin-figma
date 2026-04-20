# Optimize Toolkit

Plugin Figma para otimizar arquivos antes de rodar testes de usabilidade e apresentações no Maze, Lookback ou qualquer ferramenta de prototipação.

---

## O que é

Optimize Toolkit é um plugin que identifica e remove elementos desnecessários da página atual do Figma — instâncias de componentes vinculadas a bibliotecas externas e layers ocultas — reduzindo o peso do arquivo e eliminando dependências antes de compartilhar protótipos com stakeholders e clientes.

---

## Para que serve

Quando você compartilha um protótipo Figma com alguém de fora do seu time — seja via Maze, seja pelo link de apresentação —, o arquivo carrega consigo todas as dependências de componentes vinculados a bibliotecas, além de camadas ocultas acumuladas ao longo do processo de design. Isso causa três problemas práticos:

**Lentidão no carregamento.** Protótipos com muitas instâncias vinculadas a bibliotecas externas demoram mais para carregar, especialmente em dispositivos mais simples usados por participantes de testes.

**Dependências frágeis.** Se a biblioteca do time for atualizada ou ficar temporariamente indisponível, o protótipo pode quebrar durante uma sessão de teste ou apresentação — na pior hora possível.

**Arquivos pesados sem necessidade.** Layers ocultas deixadas por iterações anteriores ocupam memória sem contribuir nada para a experiência final.

---

## Como funciona

O plugin opera exclusivamente na página atual, em dois módulos independentes:

**Componentes**
Escaneia todos os nós do tipo `INSTANCE` na página, lista cada um com nome, componente pai, tamanho estimado e número de nós filhos. Você seleciona quais deseja desvincular — individualmente ou em massa — e o plugin executa o detach de forma segura, do nó mais profundo para o mais raso, evitando erros em componentes aninhados.

**Layers ocultas**
Identifica todos os elementos com `visible: false` na página, exibe a lista com o mesmo padrão de informação e permite remoção seletiva ou em massa. Um botão de ação rápida aparece automaticamente após cada operação de detach, caso novas layers ocultas tenham surgido.

---

## Benefícios para prototipação com stakeholders e clientes

**Testes mais confiáveis no Maze**
Ao desvincular instâncias antes de exportar o protótipo, você elimina a dependência de bibliotecas externas. O protótipo fica autossuficiente — funciona independente de qualquer atualização futura na design system.

**Carregamento mais rápido**
Menos nós, menos dependências externas, arquivo mais leve. Participantes de testes de usabilidade têm uma experiência mais fluida, o que reduz interrupções que poderiam contaminar os resultados.

**Apresentações sem surpresas**
Demos para clientes e stakeholders acontecem em ambientes imprevisíveis — redes lentas, dispositivos variados, horários críticos. Um protótipo otimizado tem menos pontos de falha.

**Rastreabilidade das otimizações**
O plugin mantém um histórico local das operações realizadas na sessão: quantas instâncias foram desvinculadas, quantas layers foram removidas, quanto espaço foi liberado e o tamanho da página antes e depois de cada ação.

**Fluxo não-destrutivo**
Todas as ações são realizadas em uma cópia ou na página selecionada. O plugin não toca em outros arquivos ou páginas. A recomendação é sempre duplicar o arquivo antes de otimizar — aviso exibido de forma visível antes de qualquer ação.

---

## Métricas exibidas

| Métrica | Descrição |
|---|---|
| Instâncias encontradas | Total de componentes vinculados na página atual |
| Tamanho estimado | Estimativa em KB baseada na contagem de nós por tipo |
| Memória da página | Estimativa do peso da página (nós × peso médio por tipo) |
| Memória do arquivo | Estimativa agregada de todas as páginas do arquivo |
| Espaço liberado | Diferença de tamanho antes e depois de cada operação |

> **Nota sobre a estimativa de memória:** A API do Figma Plugin não expõe diretamente os dados do painel "Manage Memory". Os valores exibidos são estimativas calculadas a partir da contagem e tipagem real dos nós (FRAME, INSTANCE, VECTOR, TEXT, IMAGE), úteis para acompanhar a evolução relativa entre operações — não como medição absoluta do arquivo.

---

## Instalação

1. Baixe o arquivo `.zip` e extraia a pasta
2. No Figma, acesse `Plugins → Development → Import plugin from manifest…`
3. Selecione o arquivo `manifest.json` dentro da pasta extraída
4. O plugin aparecerá em `Plugins → Development → Optimize Toolkit`

---

## Uso recomendado

1. Duplique o arquivo Figma antes de otimizar
2. Navegue para a página do protótipo que será compartilhado
3. Abra o Optimize Toolkit e clique em **Escanear página**
4. Selecione as instâncias a desvincular (recomendado: selecionar tudo)
5. Execute o detach
6. Se o botão de layers ocultas aparecer, remova-as também
7. Compartilhe o link do protótipo ou exporte para o Maze

---

## Tecnologia

Desenvolvido com a Figma Plugin API. Funciona inteiramente no lado do cliente, sem comunicação com servidores externos. Nenhum dado do arquivo é transmitido para fora do Figma.
