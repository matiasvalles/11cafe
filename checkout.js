import { MercadoPagoConfig, Preference } from 'mercadopago';
import { getFirebaseAdmin } from './firebaseAdmin.js';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utilizar POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      cart,
      items,
      uid,
      userId,
      customerEmail,
      customerName,
      customerPhone,
      shippingAddress,
      deliveryMethod,
      shippingCost = 0,
      discount = 0,
      total,
      storeName,
      publicStoreUrl,
    } = body;

    const finalUid = uid || userId || 'anonymous';
    const rawItems = Array.isArray(cart) && cart.length > 0 ? cart : (Array.isArray(items) ? items : []);

    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'El carrito no contiene productos.' });
    }

    // Normalizar items para Mercado Pago y Firestore
    const orderItems = rawItems.map((it, idx) => {
      const prod = it.product || it;
      const title = prod.name || prod.title || `Producto #${idx + 1}`;
      const unitPrice = Math.max(0, Number(prod.price || prod.unit_price || 0));
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      const picture = prod.image || prod.picture_url || '';

      return {
        id: String(prod.id || prod.sku || `item-${idx + 1}`),
        title: String(title).slice(0, 256),
        description: String(prod.description || prod.shortDescription || title).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250),
        picture_url: String(picture),
        category_id: String(prod.category_id || prod.category || 'others'),
        quantity: qty,
        unit_price: unitPrice,
        currency_id: 'ARS',
        variantLabel: it.variantLabel || '',
      };
    });

    const hasInvalidItem = orderItems.some(it => !Number.isFinite(it.unit_price) || it.unit_price <= 0);
    if (hasInvalidItem) {
      return res.status(400).json({ error: 'Uno o más productos del carrito tienen un precio inválido.' });
    }

    const subtotalCalc = orderItems.reduce((acc, it) => acc + (it.unit_price * it.quantity), 0);
    const finalTotal = typeof total === 'number' && total > 0 ? total : Math.max(0, subtotalCalc + Number(shippingCost) - Number(discount));

    // Generar ID único de orden
    const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Objeto de la orden para Firestore
    const orderDocument = {
      id: orderId,
      userId: finalUid,
      uid: finalUid,
      status: 'pending',
      statusStep: 1,
      customerName: customerName || 'Cliente',
      email: customerEmail || '',
      phone: customerPhone || '',
      address: shippingAddress || 'No especificada',
      deliveryMethod: deliveryMethod || 'shipping',
      items: orderItems,
      subtotal: subtotalCalc,
      shippingCost: Number(shippingCost),
      discount: Number(discount),
      total: finalTotal,
      currency: 'ARS',
      trackingCode: null,
      shippingCarrier: null,
      paymentMethod: 'mercadopago',
      preferenceId: null,
      paymentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timestamp: Date.now(),
    };

    // 1. Guardar en Cloud Firestore usando Firebase Admin SDK si está configurado
    const { db, isConfigured } = getFirebaseAdmin();
    let firestoreSaved = false;

    if (db && isConfigured) {
      try {
        await db.collection('orders').doc(orderId).set(orderDocument);
        firestoreSaved = true;
      } catch (dbErr) {
        console.error('[Firestore Admin Error] Error al guardar orden:', dbErr.message);
      }
    }

    // 2. Configurar Mercado Pago Access Token
    const rawMpToken = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN;
    const mpToken = typeof rawMpToken === 'string' ? rawMpToken.trim() : '';

    if (!mpToken) {
      return res.status(400).json({
        success: false,
        notConfigured: true,
        error: 'Mercado Pago no está configurado. Debes agregar la variable de entorno MP_ACCESS_TOKEN en Vercel (Settings → Environment Variables) con tu Access Token de Mercado Pago.',
      });
    }

    // Detectar host para URLs de retorno
    let baseOrigin = '';
    if (publicStoreUrl && typeof publicStoreUrl === 'string' && (publicStoreUrl.startsWith('http://') || publicStoreUrl.startsWith('https://'))) {
      baseOrigin = publicStoreUrl.replace(/\/+$/, '');
    } else if (req.headers.origin && (req.headers.origin.startsWith('http://') || req.headers.origin.startsWith('https://'))) {
      baseOrigin = req.headers.origin.replace(/\/+$/, '');
    } else if (req.headers.referer && (req.headers.referer.startsWith('http://') || req.headers.referer.startsWith('https://'))) {
      try {
        const u = new URL(req.headers.referer);
        baseOrigin = `${u.protocol}//${u.host}`;
      } catch (e) {
        baseOrigin = req.headers.referer.split('?')[0].split('#')[0].replace(/\/+$/, '');
      }
    } else if (req.headers.host) {
      const isLocal = req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1');
      const proto = (req.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https')).toString().split(',')[0].trim();
      baseOrigin = `${proto}://${req.headers.host}`;
    } else {
      baseOrigin = 'https://mercadopago.com.ar';
    }

    baseOrigin = baseOrigin.split('#')[0].replace(/\/+$/, '');

    const client = new MercadoPagoConfig({
      accessToken: mpToken,
      options: { timeout: 12000 }
    });

    const preference = new Preference(client);

    const mpPreferenceItems = orderItems.map(it => ({
      id: it.id,
      title: it.title,
      description: it.description,
      picture_url: it.picture_url,
      category_id: it.category_id,
      quantity: it.quantity,
      unit_price: Number(it.unit_price.toFixed(2)),
      currency_id: 'ARS',
    }));

    if (Number(shippingCost) > 0) {
      mpPreferenceItems.push({
        id: 'shipping-cost',
        title: 'Costo de Envío',
        description: 'Servicio de entrega logística',
        picture_url: '',
        category_id: 'shipping',
        quantity: 1,
        unit_price: Number(Number(shippingCost).toFixed(2)),
        currency_id: 'ARS',
      });
    }

    const notificationUrl = `${baseOrigin}/api/webhook`;
    const successUrl = `${baseOrigin}/?status=approved&order_id=${encodeURIComponent(orderId)}`;
    const pendingUrl = `${baseOrigin}/?status=pending&order_id=${encodeURIComponent(orderId)}`;
    const failureUrl = `${baseOrigin}/?status=failure&order_id=${encodeURIComponent(orderId)}`;

    const cleanStoreDesc = (storeName || 'TIENDA')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .slice(0, 16) || 'TIENDA';

    const nameParts = (customerName || 'Comprador').trim().split(/\s+/);
    const firstName = nameParts[0] ? nameParts[0].slice(0, 30) : 'Comprador';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ').slice(0, 30) : 'Cliente';
    const cleanDigitsPhone = String(customerPhone || '').replace(/\D/g, '');

    const payerPayload = {
      name: firstName,
      surname: lastName,
      email: customerEmail && customerEmail.includes('@') ? customerEmail.trim() : 'comprador@ejemplo.com',
      phone: cleanDigitsPhone.length >= 6 ? { number: cleanDigitsPhone.slice(-10) } : undefined,
      address: shippingAddress ? { street_name: String(shippingAddress).slice(0, 80) } : undefined
    };

    const preferencePayload = {
      items: mpPreferenceItems,
      payer: payerPayload,
      external_reference: orderId,
      statement_descriptor: cleanStoreDesc,
      back_urls: {
        success: successUrl,
        pending: pendingUrl,
        failure: failureUrl,
      },
      auto_return: baseOrigin.startsWith('https://') ? 'approved' : undefined,
      notification_url: (notificationUrl.startsWith('https://') && !notificationUrl.includes('localhost')) ? notificationUrl : undefined,
      metadata: {
        order_id: orderId,
        user_id: finalUid,
        store_name: storeName || 'Tienda Online',
      }
    };

    const mpResponse = await preference.create({ body: preferencePayload });

    if (db && isConfigured && mpResponse.id) {
      try {
        await db.collection('orders').doc(orderId).update({
          preferenceId: mpResponse.id,
          init_point: mpResponse.init_point,
          sandbox_init_point: mpResponse.sandbox_init_point,
        });
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      orderId: orderId,
      preferenceId: mpResponse.id,
      init_point: mpResponse.init_point,
      sandbox_init_point: mpResponse.sandbox_init_point,
      firestoreSaved: firestoreSaved,
    });

  } catch (error) {
    console.error('[Checkout Endpoint Error]:', error);
    let detailMsg = error.message || 'Error desconocido al crear preferencia.';
    if (error.cause) {
      if (Array.isArray(error.cause)) {
        detailMsg = error.cause.map(c => c.description || c.message || JSON.stringify(c)).join('; ');
      } else if (typeof error.cause === 'object') {
        detailMsg = error.cause.description || error.cause.message || JSON.stringify(error.cause);
      }
    } else if (error.api_response?.message) {
      detailMsg = error.api_response.message;
    }
    return res.status(500).json({
      error: 'No se pudo crear la preferencia con Mercado Pago: ' + detailMsg,
      details: error.cause || error.api_response || error.message
    });
  }
}
