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
   APP_STORAGE_PREFIX=farmais-tiete:metas-vendas

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
