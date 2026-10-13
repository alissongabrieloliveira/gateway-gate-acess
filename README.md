# gateway

Processo local que roda na rede do cliente (ex.: PC na portaria), mantém uma
conexão de **saída** (WebSocket) com o backend na nuvem e fala com uma
controladora de relés NSE MTCP-4E4S via TCP bruto para abrir/fechar uma
cancela eletrônica.

Nunca expõe porta nenhuma ao roteador do cliente, nunca expõe a
controladora física à internet. O mapeamento IP/porta/saída de cada
cancela vive no backend (`gate_direction_outputs`) e é enviado a este
processo pelo próprio WebSocket assim que ele autentica (ver
`src/outputsStore.js`) — não existe arquivo de config local com esse
endereço. Isso permite reconfigurar remotamente (rodando o seed do
backend de novo, inclusive contra o banco de produção) sem precisar de
acesso físico/remoto a esta máquina.

## App para a portaria (Electron) — modo principal

O porteiro abre o app **Gateway das Cancelas** no início do expediente e
fecha no fim. A janela mostra se está tudo funcionando (conexão com o
sistema e com a controladora), os eventos recentes e a configuração.

- **Configuração** (primeira vez, ou em *Configurações*): endereço do
  sistema (já vem preenchido com o de produção) e o token do gateway,
  gerado em *Controle de Portões → Gateway* no sistema (só admin, aparece
  uma vez). O token fica cifrado pelo Windows (DPAPI) em
  `%APPDATA%/Gateway das Cancelas/config.json` — só o mesmo usuário do
  Windows nesta máquina consegue ler.
- **Fechar**: o X pergunta antes de encerrar. Ao encerrar, o app avisa o
  sistema — o sininho mostra "Gateway das cancelas encerrado" (informação)
  em vez do alarme vermelho de offline. Windows desligando/logoff com o app
  aberto faz o mesmo aviso.
- **Logs**: um arquivo por dia em `%APPDATA%/Gateway das Cancelas/logs`
  (30 dias), botão *Abrir pasta de logs* na tela.
- Só abre uma instância por vez.

### Gerar o instalador

O empacotamento final (NSIS) é bloqueado pelo Controle de Aplicativos do
Windows na máquina de desenvolvimento, então o instalador é gerado no
GitHub: aba **Actions → Instalador do gateway → Run workflow** (ou criar
uma tag `vX.Y.Z`). O arquivo `Gateway-das-Cancelas-<versão>-instalador.exe`
sai em *Artifacts* da execução. Instalação por usuário (sem administrador),
com atalho na área de trabalho. Sem certificado de assinatura, o Windows
mostra "Editor desconhecido" na primeira vez (*Mais informações → Executar
assim mesmo*).

Desenvolvimento: `npm run app` abre o app a partir do código;
`npm run dist` gera o pacote em `dist/` (onde o NSIS não for bloqueado).

## Modo terminal (desenvolvimento / servidor)

Copie `.env.example` para `.env` e preencha `BACKEND_WS_URL` e
`DEVICE_TOKEN`. Depois:

```
npm install
npm start
```

Ctrl+C encerra avisando o sistema, igual ao app.

Depois de reconfigurar o endereço da controladora no sistema, reinicie o
gateway (app ou terminal) — a config só é lida na conexão.

## Protocolo NSE MTCP-4E4S

Ver `src/mtcpProtocol.js` — protocolo ASCII proprietário (não Modbus),
validado contra hardware real em 2026-09-14.
