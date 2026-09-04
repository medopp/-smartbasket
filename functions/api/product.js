export async function onRequest(context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    const requestUrl = new URL(context.request.url);
    const productUrl = requestUrl.searchParams.get("url");

    if (!productUrl) {
      return Response.json(
        { success: false, error: "ضع رابط المنتج" },
        { status: 400, headers: cors }
      );
    }

    let inputUrl;

    try {
      inputUrl = new URL(productUrl);
    } catch {
      return Response.json(
        { success: false, error: "الرابط غير صحيح" },
        { status: 400, headers: cors }
      );
    }

    const host = inputUrl.hostname.toLowerCase();

    if (!host.includes("1688.com")) {
      return Response.json(
        { success: false, error: "حالياً هذا الرابط مخصص لـ 1688 فقط" },
        { status: 400, headers: cors }
      );
    }

    let finalUrl = productUrl;

    // Resolve short 1688 links such as qr.1688.com
    try {
      const resolved = await fetch(productUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (resolved.url) {
        finalUrl = resolved.url;
      }
    } catch {
      // Continue using the original URL
    }

    let offerId = null;

    // Look for the 1688 offer ID in the final URL
    const offerMatch = finalUrl.match(/(?:offer|offerId)[\/=](\d{8,})/i);

    if (offerMatch) {
      offerId = offerMatch[1];
    }

    // Fallback: find any long numeric ID in the URL
    if (!offerId) {
      const numbers = finalUrl.match(/\d{10,}/g);
      if (numbers && numbers.length) {
        offerId = numbers[0];
      }
    }

    // Also check the original URL
    if (!offerId) {
      const numbers = productUrl.match(/\d{10,}/g);
      if (numbers && numbers.length) {
        offerId = numbers[0];
      }
    }

    if (!offerId) {
      return Response.json(
        {
          success: false,
          error: "لم نتمكن من استخراج رقم منتج 1688 من الرابط",
          url: finalUrl
        },
        { status: 400, headers: cors }
      );
    }

    const apiKey = context.env.PARSE_API_KEY;

    if (!apiKey) {
      return Response.json(
        { success: false, error: "PARSE_API_KEY غير مضبوط في Cloudflare" },
        { status: 500, headers: cors }
      );
    }

    const parseUrl =
      "https://api.parse.bot/scraper/bce3cd9b-591a-4e87-a406-6e57ab0dd092/get_product_details" +
      "?offer_id=" +
      encodeURIComponent(offerId);

    const parseResponse = await fetch(parseUrl, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "API-Snapshot-Version": "7"
      }
    });

    const parseData = await parseResponse.json();

    if (!parseResponse.ok) {
      return Response.json(
        {
          success: false,
          error: "فشل الاتصال بخدمة 1688",
          details: parseData
        },
        { status: 502, headers: cors }
      );
    }

    const data = parseData.data || parseData;

    return Response.json(
      {
        success: true,
        platform: "1688",
        offer_id: offerId,
        source_url: productUrl,
        title: data.title || "",
        price: data.price_display || data.min_price || data.price || "",
        min_price: data.min_price || "",
        max_price: data.max_price || "",
        currency: "CNY",
        unit: data.unit || "",
        moq: data.moq ?? null,
        company_name: data.company_name || "",
        province: data.province || "",
        city: data.city || "",
        images: Array.isArray(data.images) ? data.images : [],
        detail_url: data.detail_url || finalUrl,
        raw: data
      },
      { headers: cors }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "حدث خطأ في جلب بيانات المنتج",
        details: error?.message || String(error)
      },
      { status: 500, headers: cors }
    );
  }
}