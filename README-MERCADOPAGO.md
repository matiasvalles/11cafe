# Configurar pagos reales de Mercado Pago — Cafe 11*

Este sitio incluye una función serverless (`api/create-preference.js`) que crea
preferencias de pago reales en Mercado Pago. Para que funcione en producción:

## 1. Desplegar en Vercel

Subí todos estos archivos (manteniendo la carpeta `api/` tal cual) a un repositorio
de GitHub y conectalo a Vercel, o usá `vercel deploy` desde la CLI. Vercel detecta
automáticamente los archivos dentro de `api/` como funciones serverless — no hace
falta configuración adicional.

## 2. Configurar el Access Token

1. Andá a tu proyecto en [vercel.com](https://vercel.com) → **Settings** → **Environment Variables**.
2. Agregá una variable llamada `MP_ACCESS_TOKEN` con el valor de tu Access Token
   de Mercado Pago (lo encontrás en tu [panel de desarrolladores de Mercado Pago](https://www.mercadopago.com/developers/panel)).
   - Usá el Access Token de **prueba** (`TEST-...`) mientras testeás.
   - Usá el Access Token de **producción** (`APP_USR-...`) cuando estés listo para cobrar de verdad.
3. Volvé a desplegar el proyecto (Deployments → ⋯ → Redeploy) para que la nueva
   variable de entorno tome efecto.

## 3. Probar

Agregá un producto al carrito y presioná "Proceder al Pago". El botón va a mostrar
"Redirigiendo a Mercado Pago..." mientras la función serverless crea la preferencia,
y luego te va a redirigir al checkout real (o sandbox, si el modo de prueba está
activo) de Mercado Pago.

## Notas de seguridad

- El Access Token **nunca** se incluye en el HTML/JS del sitio: vive solo como
  variable de entorno de Vercel y se usa exclusivamente dentro de `api/create-preference.js`.
- La función serverless vuelve a validar los precios y cantidades del lado del
  servidor antes de crear la preferencia, en vez de confiar ciegamente en lo que
  manda el navegador.
- No compartas tu Access Token de producción; si sospechás que se filtró,
  regeneralo desde el panel de Mercado Pago.
