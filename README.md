# Optimize Toolkit

**Plugin Figma para preparar protótipos antes de testes de usabilidade no Maze, Lookback e similares.**

Centraliza 17 otimizações cobrindo componentes vinculados, layers ocultas, imagens, interações de protótipo, renderização, estrutura de nós e gestão de páginas. Calcula um score de prontidão calibrado com a documentação oficial do Maze e protege o arquivo com guardrails antes de qualquer operação destrutiva.

## Por que existe

Designers que preparam testes de usabilidade enfrentam um problema silencioso antes de cada sessão: arquivos Figma acumulam instâncias vinculadas a bibliotecas, layers ocultas, imagens não comprimidas e estruturas de layers excessivamente complexas. Isso causa protótipos lentos, crashes em iOS durante testes no Maze e dependências frágeis de bibliotecas externas.

## Funcionalidades principais

- **Score de prontidão (0-100)** com 7 dimensões calibradas pela doc do Maze
- **17 otimizações** acessíveis por menu de páginas dedicadas
- **Histórico estilo extrato bancário** com impacto no score por ação
- **Cache de resultados** com invalidação seletiva — sem re-scans desnecessários
- **Tema dark/light** sincronizado com a preferência do sistema
- **Guardrails** que bloqueiam o uso em arquivos de design system ou biblioteca
- **Score por fluxo ativo** — calcula só os frames conectados ao starting point

## Instalação local (desenvolvimento)

```
1. git clone https://github.com/<seu-usuario>/optimize-toolkit
2. Abra o Figma Desktop
3. Plugins → Development → Import plugin from manifest...
4. Selecione manifest.json na raiz do repo
5. O plugin aparecerá em Plugins → Development → Optimize Toolkit
```

## Como usar

1. Abra o arquivo Figma que será usado no teste de usabilidade
2. Navegue até a página de protótipo (deve estar nomeada com "Protótipo" ou "Prototype")
3. Plugins → Optimize Toolkit
4. O scan inicial mapeia o arquivo e calcula o score
5. Use o menu para acessar cada categoria de otimização
6. O score sobe imediatamente após cada ação executada
7. Histórico (ícone ↺ no header) mostra o extrato de tudo que foi feito

**Pré-requisitos do arquivo:**
- Máximo 2 páginas reais (separadores ignorados)
- Página atual nomeada com "Protótipo" ou "Prototype"

Esses guardrails impedem uso acidental em arquivos de biblioteca ou design system.

## Score de prontidão

| Faixa | Status | Significado |
|---|---|---|
| 80-100 | 🟢 Pronto | Bom para testes no Maze |
| 60-79 | 🟡 Revisar | Ajustes pontuais recomendados |
| 35-59 | 🟠 Pesado | Risco de lentidão em mobile |
| 0-34 | 🔴 Crítico | Provável crash em iOS |

7 dimensões avaliadas: instâncias vinculadas (-35), layers ocultas (-20), imagens (-25), nós totais (-18), fontes customizadas (-12), páginas (-20), interações do protótipo (-10).

## Estrutura do projeto

```
optimize-toolkit/
├── manifest.json          Configuração do plugin (Figma API 1.0.0)
├── code.js                Plugin sandbox (lógica + acesso à Figma API)
├── ui.html                Interface (HTML + CSS + JS inline em iframe)
├── README.md              Este arquivo
├── CHANGELOG.md           Histórico de versões
├── LICENSE                MIT
├── .gitignore             Node, OS, IDE
├── EVOLUTION_REPORT.md    Diagnóstico de bugs e roadmap (interno)
└── optimize-toolkit-prd.md  PRD completo do produto (referência)
```
