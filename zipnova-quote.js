// api/zipnova-quote.js
// Función serverless de Vercel: cotiza tarifas reales de envío con Zipnova usando
// credenciales privadas configuradas como variables de entorno del servidor.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const origin = body.origin || {};
  const destination = body.destination || {};
  const packages = body.packages || [];

  const originZip = String(origin.postal_code || origin.zipcode || body.origin_postal_code || body.originZip || "1230").trim();
  const destZip = String(destination.postal_code || destination.zipcode || body.destination_postal_code || body.destZip || body.zip || "5000").trim();
  const weightKg = Number(packages[0]?.weight ? (packages[0].weight > 10 ? packages[0].weight / 1000 : packages[0].weight) : (body.weight_kg || body.weight || 0.5));
  const lengthCm = Number(packages[0]?.length || body.length || 20);
  const widthCm = Number(packages[0]?.width || body.width || 15);
  const heightCm = Number(packages[0]?.height || body.height || 10);
  const declaredValue = Number(packages[0]?.declared_value || body.declared_value || 10000);

  const apiKey = (process.env.ZIPNOVA_API_KEY || "").trim();
  const apiSecret = (process.env.ZIPNOVA_API_SECRET || "").trim();
  const accountIdEnv = (process.env.ZIPNOVA_ACCOUNT_ID || "").trim();
  const isSandbox = process.env.ZIPNOVA_SANDBOX ? process.env.ZIPNOVA_SANDBOX !== "false" : (body.isSandbox !== false);

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      notConfigured: true,
      rates: [],
      error: "Zipnova no está configurado en las variables de entorno de Vercel. Debe configurar ZIPNOVA_API_KEY y ZIPNOVA_API_SECRET en Vercel (Project Settings → Environment Variables)."
    });
  }

  try {
    const authHeader = "Basic " + Buffer.from(apiKey + ":" + apiSecret).toString("base64");
    const baseUrls = isSandbox
      ? ["https://api.zipnova.com.ar/v2", "https://sandbox.api.zipnova.com.ar/v2"]
      : ["https://api.zipnova.com.ar/v2"];

    let accountId = accountIdEnv && !isNaN(Number(accountIdEnv)) ? parseInt(accountIdEnv, 10) : null;
    if (!accountId) {
      for (const bUrl of baseUrls) {
        try {
          const accRes = await fetch(`${bUrl}/accounts`, {
            headers: { Authorization: authHeader, Accept: "application/json" }
          });
          if (accRes.ok) {
            const accData = await accRes.json();
            const list = Array.isArray(accData) ? accData : (accData.data || accData.accounts || []);
            const rawId = list[0]?.id ?? list[0]?.account_id ?? null;
            if (rawId !== null) {
              accountId = parseInt(String(rawId), 10);
              break;
            }
          }
        } catch (e) {}
      }
    }

    const payloadsToTry = [];
    if (accountId) {
      payloadsToTry.push({
        account_id: accountId,
        declared_value: declaredValue,
        origin: {
          zipcode: originZip,
          postal_code: originZip,
          city: origin.city || "CABA",
          state: origin.state || origin.province || "Buenos Aires",
          country: "AR"
        },
        destination: {
          zipcode: destZip,
          postal_code: destZip,
          city: destination.city || "Córdoba",
          state: destination.state || destination.province || "Córdoba",
          country: "AR"
        },
        packages: [{
          weight: Math.max(10, weightKg < 10 ? Math.round(weightKg * 1000) : Math.round(weightKg)),
          length: lengthCm,
          width: widthCm,
          height: heightCm,
          sku: "PROD-DEFAULT",
          classification_id: 1,
          declared_value: declaredValue
        }]
      });
      payloadsToTry.push({
        account_id: accountId,
        declared_value: declaredValue,
        destination: {
          zipcode: destZip,
          city: destination.city || "Córdoba",
          state: destination.state || destination.province || "Córdoba",
          country: "AR"
        },
        packages: [{
          weight: Math.max(10, weightKg < 10 ? Math.round(weightKg * 1000) : Math.round(weightKg)),
          length: lengthCm,
          width: widthCm,
          height: heightCm,
          sku: "PROD-DEFAULT",
          classification_id: 1,
          declared_value: declaredValue
        }]
      });
    } else {
      payloadsToTry.push({
        declared_value: declaredValue,
        origin: {
          zipcode: originZip,
          postal_code: originZip,
          city: origin.city || "CABA",
          state: origin.state || origin.province || "Buenos Aires",
          country: "AR"
        },
        destination: {
          zipcode: destZip,
          postal_code: destZip,
          city: destination.city || "Córdoba",
          state: destination.state || destination.province || "Córdoba",
          country: "AR"
        },
        packages: [{
          weight: Math.max(10, weightKg < 10 ? Math.round(weightKg * 1000) : Math.round(weightKg)),
          length: lengthCm,
          width: widthCm,
          height: heightCm,
          sku: "PROD-DEFAULT",
          classification_id: 1,
          declared_value: declaredValue
        }]
      });
    }

    let lastErrorMessage = "";

    for (const baseUrl of baseUrls) {
      const endpoints = accountId
        ? [`${baseUrl}/shipments/quote`, `${baseUrl}/shipments/quote?account_id=${accountId}`]
        : [`${baseUrl}/shipments/quote`];

      for (const endpointUrl of endpoints) {
        for (const payload of payloadsToTry) {
          try {
            const quoteRes = await fetch(endpointUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                Accept: "application/json"
              },
              body: JSON.stringify(payload)
            });

            if (quoteRes.ok) {
              const data = await quoteRes.json();
              let rawList = [];
              if (Array.isArray(data)) rawList = data;
              else if (Array.isArray(data.rates)) rawList = data.rates;
              else if (Array.isArray(data.data)) rawList = data.data;
              else if (Array.isArray(data.options)) rawList = data.options;

              if (rawList.length > 0) {
                const rates = rawList.map((r, idx) => {
                  const daysMin = Number(r.delivery_days_min || r.days_min || r.delivery_days || r.days || 2) || 2;
                  const daysMax = Number(r.delivery_days_max || r.days_max || r.delivery_days || (daysMin > 0 ? daysMin + 2 : 5)) || Math.max(daysMin + 1, 4);
                  const priceVal = Number(r.price ?? r.total ?? r.cost ?? r.rate ?? r.final_price ?? r.tax_included_price ?? r.subtotal ?? r.amount ?? r.value ?? 0);

                  return {
                    id: r.id || r.service_code || `zn_rate_${idx}`,
                    carrier_id: r.carrier_id || r.carrier || "zipnova",
                    carrier: r.carrier || r.courier_name || "Zipnova Envíos",
                    courier_name: r.courier_name || r.name || `${r.carrier || "Envío"} ${r.service_type || ""}`.trim(),
                    service_type: r.service_type || "standard",
                    price: Math.round(priceVal * 100) / 100,
                    currency: r.currency || "ARS",
                    delivery_days_min: daysMin,
                    delivery_days_max: daysMax,
                    delivery_estimate: r.delivery_estimate || r.estimated_delivery || (
                      daysMin === daysMax
                        ? `Llega en ${daysMin} día${daysMin > 1 ? 's' : ''} hábil${daysMin > 1 ? 'es' : ''}`
                        : `${daysMin} a ${daysMax} días hábiles`
                    ),
                    is_pickup_point: Boolean(r.is_pickup_point || r.pickup_point || r.service_type === "locker" || r.service_type === "point")
                  };
                });
                return res.status(200).json({ success: true, rates, origin_postal_code: originZip, destination_postal_code: destZip });
              }
            } else {
              const errBody = await quoteRes.text().catch(() => "");
              lastErrorMessage = `HTTP ${quoteRes.status}: ${errBody || quoteRes.statusText}`;
            }
          } catch (e) {
            lastErrorMessage = e.message;
          }
        }
      }
    }

    return res.status(502).json({
      success: false,
      rates: [],
      error: lastErrorMessage || `No se pudieron obtener cotizaciones desde la API de Zipnova para el CP ${destZip}. Verifique sus credenciales y cobertura.`
    });

  } catch (err) {
    console.error("[Zipnova Serverless Error]:", err);
    return res.status(500).json({
      success: false,
      rates: [],
      error: err.message || "Error interno al consultar la API de Zipnova."
    });
  }
}
