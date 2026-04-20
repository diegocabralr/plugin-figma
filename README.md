# Optimize Toolkit

Plugin para Figma que ajuda a limpar e enxugar arquivos antes de rodar testes de usabilidade ou testes de conceito no Maze, Figma app ou qualquer outra ferramenta de testes

---

## O que é

O Optimize Toolkit é um plugin que escaneia a página atual do Figma e identifica elementos que só pesam o arquivo sem agregar valor ao protótipo final — como instâncias de componentes ligadas a bibliotecas externas e layers ocultas.  
A ideia é reduzir o peso da página e remover dependências antes de compartilhar o arquivo com stakeholders, clientes ou participantes de pesquisa.

---

## Para que serve

Quando você compartilha um protótipo Figma com alguém de fora do time — seja via Maze, seja por link de apresentação — o arquivo leva junto:

- todas as instâncias conectadas a bibliotecas do time  
- e camadas ocultas acumuladas ao longo das iterações

Isso costuma gerar três problemas bem práticos:

**Lentidão no carregamento**  
Protótipos com muitas instâncias vinculadas a bibliotecas externas demoram mais para carregar, principalmente em dispositivos mais simples usados em testes.

**Dependências frágeis**  
Se a biblioteca for atualizada, renomeada ou ficar temporariamente indisponível, o protótipo pode quebrar bem na hora da sessão de teste ou da apresentação.

**Arquivo mais pesado do que precisa**  
Layers ocultas deixadas por versões anteriores continuam ocupando memória sem contribuir em nada para a experiência final.

O Optimize Toolkit ajuda a reduzir esses riscos antes do compartilhamento.

---

## Como funciona

O plugin atua apenas na página atual e é dividido em dois módulos independentes:

### 1. Componentes

- Escaneia todos os nós do tipo `INSTANCE` na página.  
- Lista cada instância com: nome, componente pai, tamanho estimado e número de nós filhos.  
- Você escolhe o que quer desvincular — item a item ou tudo de uma vez.  
- O detach é feito em ordem segura (do nó mais profundo para o mais raso), evitando problemas em componentes aninhados.

### 2. Layers ocultas

- Identifica todos os elementos com `visible: false` na página.  
- Exibe uma lista com o mesmo padrão de informações.  
- Permite remover layers seletivamente ou em massa.  
- Depois de cada operação de detach, um botão rápido aparece caso novas layers ocultas tenham surgido e também possam ser removidas.

---

## Benefícios para prototipação com stakeholders e clientes

**Testes mais confiáveis no Maze**  
Ao desvincular as instâncias antes de exportar o protótipo, você remove a dependência de bibliotecas externas. O protótipo fica autossuficiente — não depende de atualizações futuras do design system para funcionar.

**Carregamento mais rápido**  
Menos nós + menos dependências externas = arquivo mais leve.  
Participantes de pesquisa têm uma experiência mais fluida, com menos travamentos e atrasos que poderiam interferir nos resultados.

**Apresentações sem surpresas**  
Apresentações para clientes e stakeholders acontecem em contextos pouco controlados:  
redes lentas, dispositivos variados, horários de pico. Um protótipo otimizado tem menos pontos de falha nesses cenários.

**Histórico das otimizações**  
O plugin mantém um histórico local da sessão:  
quantas instâncias foram desvinculadas, quantas layers foram removidas, quanto espaço foi liberado e o tamanho da página antes e depois de cada ação.

**Fluxo não destrutivo**  
Todas as ações são feitas apenas na página atual ou em cópias.  
O plugin não altera outras páginas ou arquivos.  
Ainda assim, a recomendação é sempre duplicar o arquivo antes de otimizar — esse aviso aparece de forma clara antes de qualquer operação.

---

## Métricas exibidas

| Métrica              | Descrição                                                       |
|----------------------|-----------------------------------------------------------------|
| Instâncias encontradas | Total de componentes vinculados na página atual               |
| Tamanho estimado     | Estimativa em KB baseada na contagem de nós por tipo           |
| Memória da página    | Estimativa do peso da página (nós × peso médio por tipo)       |
| Memória do arquivo   | Estimativa agregada de todas as páginas do arquivo             |
| Espaço liberado      | Diferença de tamanho antes e depois de cada operação           |

> **Sobre a estimativa de memória**  
> A Figma Plugin API não expõe diretamente os mesmos dados do painel “Manage Memory”.  
> As métricas exibidas são estimativas calculadas a partir da contagem e do tipo de nós (FRAME, INSTANCE, VECTOR, TEXT, IMAGE).  
> Elas são úteis para acompanhar a variação entre operações — não como medição absoluta e precisa do arquivo.

---

## Instalação

1. Baixe o arquivo `.zip` e extraia a pasta.
2. No Figma, acesse `Plugins → Development → Import plugin from manifest…`.
3. Selecione o arquivo `manifest.json` dentro da pasta extraída.
4. O plugin aparecerá em `Plugins → Development → Optimize Toolkit`.

---

## Uso recomendado

1. Duplique o arquivo Figma que será usado no teste ou na apresentação.
2. Vá para a página do protótipo que será compartilhado.
3. Abra o Optimize Toolkit e clique em **Escanear página**.
4. Selecione as instâncias que deseja desvincular (em geral, faz sentido selecionar tudo).
5. Execute o detach.
6. Se o módulo de layers ocultas for habilitado, remova as layers que fizerem sentido.
7. Compartilhe o link do protótipo ou exporte para o Maze.

---

## Tecnologia

O Optimize Toolkit é desenvolvido com a Figma Plugin API.  
Ele roda inteiramente no cliente, sem comunicação com servidores externos.  
Nenhum dado do arquivo é enviado para fora do Figma.
