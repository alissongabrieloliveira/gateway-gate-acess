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

## Configuração

Copie `.env.example` para `.env` e preencha `BACKEND_WS_URL` e
`DEVICE_TOKEN` (obtido rodando `npm run seed` no backend — ver
`backend/src/db/seeds/002_gateway_provisioning.js`, que também é onde o
endereço real da controladora é configurado). É só isso — nada mais
precisa ser editado nesta máquina.

## Uso

```
npm install
npm start
```

Depois de reconfigurar o endereço da controladora (rodando o seed do
backend de novo), reinicie este processo — a config só é lida na conexão.

## Protocolo NSE MTCP-4E4S

Ver `src/mtcpProtocol.js` — protocolo ASCII proprietário (não Modbus),
validado contra hardware real em 2026-09-14.
