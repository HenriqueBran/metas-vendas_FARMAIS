VERSÃO FINAL VALIDADA PARA USO

Inclui:
- Login com token de sessão.
- API de dados protegida por sessão.
- Botão Criar login bloqueado após o primeiro usuário.
- Logout ao fechar aba/acessar link novamente.
- Logout automático após 10 minutos sem interação na tela.
- Funcionários permanecem nos próximos meses.
- Domingos preenchidos automaticamente como Folga.
- Economia de comandos no Upstash.
- Validação de sintaxe e teste de API realizados.

Importante:
- F5/recarregar mantém o login.
- 10 minutos sem clicar, digitar, rolar ou tocar na tela encerram a sessão.
- O logout por inatividade não fica consultando o Upstash; ele só invalida a sessão no momento do logout.


Atualização:
- Alerta visual de inatividade aparece após 9 minutos sem interação.
- O usuário tem 60 segundos para clicar em "Continuar sessão".
- Se não clicar, a sessão encerra automaticamente aos 10 minutos.
