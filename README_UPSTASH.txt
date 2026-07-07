COMO USAR COM UPSTASH

1. Crie um banco Redis no Upstash.
2. Copie:
   - UPSTASH_REDIS_REST_URL
   - UPSTASH_REDIS_REST_TOKEN

3. Hospede o projeto em uma plataforma com funções serverless, por exemplo Vercel.
   Importante: escolha a pasta 'nadia' como raiz do projeto.

4. Em Environment Variables, adicione:
   UPSTASH_REDIS_REST_URL
   UPSTASH_REDIS_REST_TOKEN
   APP_STORAGE_PREFIX=farmais-tiete:metas-vendas:reset-2026-07-07

5. Depois de publicar, acesse o link online do sistema.
   Ao alterar o mês em "Metas do mês", o sistema salva e carrega os dados daquele mês separadamente.

Observação:
- Abrindo apenas o index.html direto no computador, o sistema continua funcionando com localStorage.
- Para salvar no Upstash, precisa estar online em um servidor com a pasta /api funcionando.


TELA DE LOGIN
- O sistema agora abre primeiro uma tela de login.
- A tela 'Criar login' cadastra usuários no Upstash em chaves como APP_STORAGE_PREFIX:users:nome.
- Depois de publicar na Vercel com as variáveis do Upstash, crie o primeiro login pela própria tela do sistema.


DADOS POR USUÁRIO
- Agora os lançamentos/metas ficam separados por usuário.
- Exemplo de chave no Upstash:
  farmais-tiete:metas-vendas:data:nadia:2026-07
- Quando o usuário fecha o navegador e loga novamente, o sistema carrega automaticamente os dados salvos daquele usuário e mês.


ERRO AO CRIAR LOGIN

Se aparecer erro ao criar usuário na Vercel, confira:
1. Se as variáveis de ambiente existem no projeto:
   UPSTASH_REDIS_REST_URL
   UPSTASH_REDIS_REST_TOKEN
   APP_STORAGE_PREFIX

2. Depois de adicionar ou alterar variáveis, faça Redeploy na Vercel.

3. Se o erro for "Upstash não configurado", o problema está nas variáveis da Vercel.

4. Use usuário simples, por exemplo:
   admin
   nadia
   farmais-tiete

Esta versão também aceita nomes com espaço; eles são convertidos automaticamente para chave segura.


LÓGICA DA PLANILHA
- Meta individual e meta diária são campos próprios por funcionário, como na calculadora.
- Percentual (%) fica cadastrado, mas não é usado para calcular a meta individual.
- Total vendido por funcionário soma somente valores numéricos; textos como FOLGA, folga e atestado valem zero.
- % atingido = vendido do funcionário / meta individual.
- Participação = vendido do funcionário / total vendido da loja.
- Premiação = participação * premiação configurada.
- Percentual geral atingido = total vendido da loja / meta do mês.


META AUTOMÁTICA
- Meta individual = Meta do mês x (percentual do funcionário / soma dos percentuais).
- Meta diária = Meta individual / Dias de trabalho.
- Ao alterar Meta do mês, Dias de trabalho, Premiação projetada ou Percentual (%), o sistema recalcula automaticamente.


RESET TOTAL:
Esta versão usa um prefixo novo e limpo:
farmais-tiete:metas-vendas:reset-2026-07-07

Na prática, os usuários, meses, metas, lançamentos e vendas extras antigos não serão carregados.
Você poderá criar o login novamente e cadastrar tudo do zero.

Observação: os dados antigos podem continuar armazenados no Upstash, mas esta versão não usa mais eles.
