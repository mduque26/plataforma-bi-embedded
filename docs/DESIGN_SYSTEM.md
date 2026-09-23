# Sistema visual do portal

## Direção

O portal usa a linguagem de uma mesa de análise corporativa: densa o suficiente para operação diária, sóbria e orientada a dados. A interface deve parecer uma ferramenta de trabalho pertencente ao tenant, não uma página promocional.

## Princípios

- A informação vem antes da decoração.
- Azul identifica seleção, ação primária e estado ativo. Não colore superfícies inteiras sem função.
- Superfícies são planas, separadas por linhas. Sombras ficam restritas a diálogos e mensagens flutuantes.
- Raios pequenos, de 4 a 7 px, reforçam o caráter corporativo.
- Métricas formam faixas contínuas; relatórios formam um registro; filtros se comportam como controles de trabalho.
- Identidade do tenant pode substituir marca, cor e imagem de acesso sem alterar a estrutura do produto.

## Tokens

- `--chrome`: navegação global em azul-marinho.
- `--accent`: cor configurável do tenant para ações e seleção.
- `--canvas`: fundo da área de trabalho.
- `--surface`: superfícies de conteúdo e controles.
- `--line`: divisórias e limites de componentes.
- `--ink` e `--muted`: texto principal e auxiliar.
- `--radius`: raio-base de 6 px.

## Componentes

- Navegação: barra escura, item ativo por sublinhado e sem cápsulas.
- Catálogo: duas colunas em telas amplas, linhas divisórias e ícone funcional. Não usar gráficos decorativos.
- Tabelas: cabeçalho discreto, linhas compactas e ações no contexto.
- Métricas: faixa contínua com divisórias, sem cartões independentes.
- Modais: cabeçalho neutro, navegação interna por abas lineares e rodapé fixo para ações.
- Formulários: campos de 44 px, rótulos persistentes e foco visível.
- Estados: cor sempre acompanhada de texto ou ícone.

## Responsividade e temas

- A grade de catálogo passa para uma coluna abaixo de 700 px.
- Tabelas mantêm rolagem horizontal quando necessário.
- Modais ocupam quase toda a altura em telas pequenas e preservam ações visíveis.
- Temas claro e escuro usam a mesma hierarquia; somente os tokens de superfície e contraste mudam.

## Evitar

- Gradientes decorativos, blobs, brilhos e sombras em todos os cartões.
- Sequências de cartões arredondados com a mesma importância visual.
- Gráficos falsos, texto promocional genérico e excesso de rótulos em caixa alta.
- Animações de entrada ou efeitos que atrasem tarefas administrativas.
