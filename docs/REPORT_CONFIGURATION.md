# Configuração de relatórios

O modal de criação e edição reúne os dados técnicos, a inspeção de RLS e a inclusão de usuários ou grupos. Em novos relatórios com acessos preparados, o item é criado inicialmente como inativo, recebe as regras e só então é publicado, evitando exposição durante uma configuração parcial.

A aba Catálogo concentra a publicação e a manutenção dos relatórios.

## Campos disponíveis

- área ou pasta existente, com criação inline de nova área;
- nome e descrição apresentados aos leitores;
- workspace, relatório e dataset do Power BI;
- URL de embed;
- classificação confidencial ou não confidencial;
- status ativo ou inativo;
- regras de acesso por usuário ou grupo;
- múltiplos papéis RLS por principal.

Quando o Microsoft Entra ID e o Power BI estão configurados, workspace e relatório são carregados diretamente do provedor. A seleção de um relatório preenche dataset, URL de embed e dispara a inspeção do modelo semântico.

## Regras de segurança

- A interface não oferece um modo RLS manual.
- O Worker repete a inspeção RLS antes de criar o relatório ou salvar regras.
- Ausência de RLS somente é aceita quando confirmada explicitamente pelo Power BI.
- Falhas de inspeção bloqueiam a gravação.
- Cada principal precisa receber ao menos um papel quando RLS estiver ativo.
- Papéis submetidos são validados contra a lista atual do modelo semântico.
- Workspace, relatório ou dataset não podem ser alterados enquanto existirem regras de acesso.
- Trocar a referência do modelo limpa os metadados RLS anteriores e executa nova inspeção.
- O catálogo normal não exibe relatórios inativos.
- A classificação confidencial não altera a regra de autorização, mas identifica o conteúdo nas superfícies administrativas.

## Ambiente local

O workspace `demo-workspace` usa os papéis demonstrativos `DemoReader` e `DemoManager`. A pesquisa de principais retorna os usuários locais criados pelo login de desenvolvimento.
