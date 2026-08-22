import { MercadoPagoConfig, Payment } from 'mercadopago';
import { getFirebaseAdmin } from './firebaseAdmin.js';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    console.log('[Mercado Pago Webhook] Notificación recibida:', {
      query: req.query,
      bodyType: req.body?.type,
      bodyAction: req.body?.action,
      bodyDataId: req.body?.data?.id
    });

    // Extraer el tipo de evento y el ID del pago
    const topic = req.query.topic || req.query.type || req.body?.type;
    const paymentId = req.query['data.id'] || req.query.id || req.body?.data?.id;

    if (!paymentId || (topic && topic !== 'payment' && topic !== 'payment.created' && topic !== 'payment.updated')) {
      // Reconocer la notificación aunque no sea de pago para que MP no reintente
      return res.status(200).json({ status: 'ignored', message: 'Notificación no corresponde a un pago' });
    }

    const { db, isConfigured } = getFirebaseAdmin();
    const mpToken = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN;

    let paymentStatus = 'approved';
    let externalReference = null;
    let paymentAmount = 0;
    let paymentDetails = null;

    // Si tenemos token de MP, consultar los datos reales de la API de Mercado Pago
    if (mpToken && mpToken.trim() !== '') {
      try {
        const client = new MercadoPagoConfig({ accessToken: mpToken.trim() });
        const paymentClient = new Payment(client);
        const paymentInfo = await paymentClient.get({ id: String(paymentId) });

        if (paymentInfo) {
          paymentStatus = paymentInfo.status; // 'approved', 'pending', 'rejected', etc.
          externalReference = paymentInfo.external_reference; // Vinculado a orderId en /api/checkout.js
          paymentAmount = paymentInfo.transaction_amount;
          paymentDetails = {
            id: paymentInfo.id,
            status: paymentInfo.status,
            status_detail: paymentInfo.status_detail,
            payment_method_id: paymentInfo.payment_method_id,
            payment_type_id: paymentInfo.payment_type_id,
            date_approved: paymentInfo.date_approved,
          };
          console.log('[Mercado Pago Webhook] Pago ' + paymentId + ' consultado con éxito: status=' + paymentStatus + ', orderId=' + externalReference);
        }
      } catch (mpErr) {
        console.error('[Mercado Pago Webhook] Error al consultar pago con SDK:', mpErr.message);
      }
    } else {
      console.log('[Mercado Pago Webhook] Modo de pruebas/simulación: simulando pago aprobado para ID:', paymentId);
      paymentStatus = 'approved';
    }

    // 2. Si el pago fue aprobado ('approved'), actualizar la orden en Firestore y generar tracking
    if (paymentStatus === 'approved') {
      const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
      const generatedTrackingCode = 'AR' + randomSuffix + 'TR';
      const shippingCarrier = 'Andreani / Logística Express';

      if (db && isConfigured) {
        let orderRef = null;

        // Buscar la orden por external_reference o por ID de documento
        if (externalReference) {
          orderRef = db.collection('orders').doc(externalReference);
        } else {
          const snapshot = await db.collection('orders')
            .where('status', '==', 'pending')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

          if (!snapshot.empty) {
            orderRef = snapshot.docs[0].ref;
          }
        }

        if (orderRef) {
          const updateData = {
            status: 'paid',
            statusStep: 2,
            paymentId: String(paymentId),
            trackingCode: generatedTrackingCode,
            shippingCarrier: shippingCarrier,
            estimatedDelivery: '3 a 5 días hábiles',
            paidAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          if (paymentDetails) {
            updateData.paymentDetails = paymentDetails;
          }

          await orderRef.update(updateData);
          console.log('[Firestore Webhook] Orden actualizada exitosamente a paid con tracking: ' + generatedTrackingCode);
        } else {
          console.warn('[Firestore Webhook] No se encontró documento de orden para externalReference: ' + externalReference);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Pago acreditado y orden actualizada a pagada con tracking generado',
        paymentId: paymentId,
        status: 'paid',
        trackingCode: generatedTrackingCode,
        shippingCarrier: shippingCarrier,
      });
    }

    // Si el pago no fue aprobado (ej. rejected o cancelled)
    if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
      if (db && isConfigured && externalReference) {
        await db.collection('orders').doc(externalReference).update({
          status: 'rejected',
          statusStep: 1,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Notificación procesada para pago en estado: ' + paymentStatus,
      paymentStatus,
    });

  } catch (error) {
    console.error('[Mercado Pago Webhook Error]:', error);
    return res.status(500).json({
      error: error.message || 'Error al procesar el webhook.',
    });
  }
}
