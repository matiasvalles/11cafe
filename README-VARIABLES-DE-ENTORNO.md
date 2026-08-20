# Variables de entorno para Vercel — Cafe 11*

Este .zip **no contiene ningún token ni credencial**. Cada función dentro de
`api/` los lee en tiempo de ejecución desde las variables de entorno de tu
proyecto en Vercel. Los valores reales de tus tokens los encontrás en el
editor, en **Exportar → Variables de entorno**, con un botón para copiar cada
uno.

## Cómo cargarlas en Vercel

1. Subí esta carpeta a un repositorio de GitHub y conectalo a Vercel (o corré
   `vercel deploy` desde la CLI).
2. En tu proyecto de Vercel: **Settings → Environment Variables**.
3. Pegá cada variable de la lista de abajo con su valor real (copiado desde
   el editor).
4. Volvé a desplegar (**Deployments → ⋯ → Redeploy**) para que tomen efecto.


## Zipnova

- `ZIPNOVA_API_KEY` y `ZIPNOVA_API_SECRET` — credenciales de tu cuenta de
  Zipnova, usadas por `api/zipnova-quote.js` para cotizar envíos.
- `ZIPNOVA_ACCOUNT_ID` — opcional; si no la configurás, la función la
  resuelve automáticamente contra tu cuenta de Zipnova.
- Si estas variables no están configuradas, el sitio sigue funcionando y
  muestra tarifas de envío simuladas en vez de fallar.

## Nota de seguridad

Ninguna de estas credenciales se envía nunca al navegador de tus visitantes:
viven solo en el servidor (Vercel) y las leen las funciones dentro de `api/`.
Si sospechás que alguna se filtró, regenerala desde el panel del proveedor
correspondiente (Mercado Pago, Zipnova o MailerLite) y actualizá el valor en
Vercel.
