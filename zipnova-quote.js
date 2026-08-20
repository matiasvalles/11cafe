// api/zipnova-quote.js
// Función serverless de Vercel: cotiza tarifas de envío con Zipnova usando
// credenciales que viven SOLO como variables de entorno del servidor.
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
  const weightKg = Number(packages[0]?.weight || body.weight_kg || body.weight || 0.5);
  const lengthCm = Number(packages[0]?.length || body.length || 20);
  const widthCm = Number(packages[0]?.width || body.width || 15);
  const heightCm = Number(packages[0]?.height || body.height || 10);
  const declaredValue = Number(packages[0]?.declared_value || body.declared_value || 10000);

  const apiKey = (process.env.ZIPNOVA_API_KEY || "").trim();
  const apiSecret = (process.env.ZIPNOVA_API_SECRET || "").trim();
  const accountIdEnv = (process.env.ZIPNOVA_ACCOUNT_ID || "").trim();
  const isSandbox = process.env.ZIPNOVA_SANDBOX ? process.env.ZIPNOVA_SANDBOX !== "false" : (body.isSandbox !== false);

  function simulatedRates() {
    const km = Math.abs(parseInt(destZip || "5000", 10) - parseInt(originZip || "1414", 10)) % 500;
    const mult = 1 + (km / 500) * 0.5 + (Math.max(1, weightKg) - 1) * 0.3;
    return [
      { id: "zn_andreani_std", carrier_id: "andreani", carrier: "Andreani", courier_name: "Andreani - Envío a Domicilio Estándar", service_type: "standard", price: Math.round(3850 * mult), currency: "ARS", delivery_days_min: 2, delivery_days_max: 4, delivery_estimate: "2 a 4 días hábiles", is_pickup_point: false },
      { id: "zn_correoarg_classic", carrier_id: "correo_argentino", carrier: "Correo Argentino", courier_name: "Correo Argentino - Encomienda Clásica Paq.ar", service_type: "classic", price: Math.round(3150 * mult), currency: "ARS", delivery_days_min: 3, delivery_days_max: 6, delivery_estimate: "3 a 6 días hábiles", is_pickup_point: false },
      { id: "zn_oca_express", carrier_id: "oca", carrier: "OCA", courier_name: "OCA Express Prioritario a Domicilio", service_type: "express", price: Math.round(5200 * mult), currency: "ARS", delivery_days_min: 1, delivery_days_max: 2, delivery_estimate: "1 a 2 días hábiles", is_pickup_point: false },
      { id: "zn_point_pickup", carrier_id: "pickit", carrier: "Puntos Pickit", courier_name: "Punto de Retiro Cercano (Pickit / Smart Locker)", service_type: "locker", price: Math.round(2600 * mult), currency: "ARS", delivery_days_min: 2, delivery_days_max: 3, delivery_estimate: "2 a 3 días hábiles", is_pickup_point: true },
    ];
  }

  if (!apiKey || !apiSecret) {
    return res.status(200).json({ success: true, rates: simulatedRates(), currency: "ARS", origin_postal_code: originZip, destination_postal_code: destZip, isSimulated: true });
  }

  try {
    const authHeader = "Basic " + Buffer.from(apiKey + ":" + apiSecret).toString("base64");
    const baseUrl = isSandbox ? "https://sandbox.api.zipnova.com.ar/v2" : "https://api.zipnova.com.ar/v2";

    let accountId = accountIdEnv && !isNaN(Number(accountIdEnv)) ? parseInt(accountIdEnv, 10) : null;
    if (!accountId) {
      const accRes = await fetch(`${baseUrl}/accounts`, { headers: { Authorization: authHeader, Accept: "application/json" } });
      if (accRes.ok) {
        const accData = await accRes.json();
        const list = Array.isArray(accData) ? accData : (accData.data || accData.accounts || []);
        const rawId = list[0]?.id ?? list[0]?.account_id ?? null;
        accountId = rawId !== null ? parseInt(String(rawId), 10) : null;
      }
    }

    const payload = {
      account_id: accountId || undefined,
      declared_value: declaredValue,
      origin: { zipcode: originZip, postal_code: originZip, city: "CABA", state: "Buenos Aires", country: "AR" },
      destination: { zipcode: destZip, postal_code: destZip, city: destination.city || "Córdoba", state: destination.state || destination.province || "Córdoba", country: "AR" },
      packages: [{ weight: Math.max(10, weightKg < 10 ? Math.round(weightKg * 1000) : Math.round(weightKg)), length: lengthCm, width: widthCm, height: heightCm, sku: "PROD-DEFAULT", classification_id: 1, declared_value: declaredValue }],
    };

    const quoteRes = await fetch(`${baseUrl}/shipments/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    if (quoteRes.ok) {
      const data = await quoteRes.json();
      const rawList = Array.isArray(data) ? data : (data.rates || data.data || data.options || []);
      if (rawList.length > 0) {
        const rates = rawList.map((r, idx) => {
          const daysMin = Number(r.delivery_days_min || r.days_min || 2) || 2;
          const daysMax = Number(r.delivery_days_max || r.days_max || daysMin + 2) || daysMin + 2;
          return {
            id: r.id || r.service_code || `zn_rate_${idx}`,
            carrier_id: r.carrier_id || r.carrier || "zipnova",
            carrier: r.carrier || r.courier_name || "Zipnova Envíos",
            courier_name: r.courier_name || r.name || `${r.carrier || "Envío"} ${r.service_type || ""}`.trim(),
            service_type: r.service_type || "standard",
            price: Math.round((Number(r.price ?? r.total ?? r.cost ?? r.amount ?? 0)) * 100) / 100,
            currency: r.currency || "ARS",
            delivery_days_min: daysMin,
            delivery_days_max: daysMax,
            delivery_estimate: r.delivery_estimate || r.estimated_delivery || `${daysMin} a ${daysMax} días hábiles`,
            is_pickup_point: Boolean(r.is_pickup_point || r.pickup_point),
          };
        });
        return res.status(200).json({ success: true, rates, origin_postal_code: originZip, destination_postal_code: destZip });
      }
    }
  } catch (err) {
    console.warn("[Zipnova] Error consultando tarifas, usando simulación:", err.message);
  }

  return res.status(200).json({ success: true, rates: simulatedRates(), currency: "ARS", origin_postal_code: originZip, destination_postal_code: destZip, isSimulated: true });
}
