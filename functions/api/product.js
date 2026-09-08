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
    const inputText = requestUrl.searchParams.get("url");

    if (!inputText) {
      return Response.json(
        { success: false, error: "ضع رابط المنتج أو نص مشاركة 1688" },
        { status: 400, headers: cors }
      );
    }

    const urlMatch = inputText.match(/https?:\/\/[^\s"'<>]+/i);
    if (!urlMatch) {
      return Response.json(
        { success: false, error: "لم نجد رابط 1688 داخل النص" },
        { status: 400, headers: cors }
      );
    }

    let productUrl = urlMatch[0].replace(/[)\]}>，。；;]+$/g, "");
    let parsedUrl;
    try {
      parsedUrl = new URL(productUrl);
    } catch {
      return Response.json({ success: false, error: "الرابط غير صحيح" }, { status: 400, headers: cors });
    }

    if (!parsedUrl.hostname.toLowerCase().includes("1688.com")) {
      return Response.json({ success: false, error: "الرابط ليس رابط 1688" }, { status: 400, headers: cors });
    }

    const extractOfferId = (text) => {
      if (!text) return null;
      return text.match(/\/offer\/(\d{8,})/i)?.[1] ||
        text.match(/offer(?:Id|_id)[=\/](\d{8,})/i)?.[1] ||
        text.match(/\b(\d{10,})\b/)?.[1] || null;
    };

    let offerId = extractOfferId(productUrl);
    let finalUrl = productUrl;

    if (!offerId) {
      try {
        const shortResponse = await fetch(productUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        });
        const location = shortResponse.headers.get("location");
        if (location) {
          try { finalUrl = new URL(location, productUrl).toString(); } catch {}
        }
        offerId = extractOfferId(finalUrl);
        if (!offerId) {
          const html = await shortResponse.text();
          offerId = extractOfferId(html);
          if (!offerId) {
            for (const possibleUrl of html.match(/https?:\/\/[^"'<>\\s]+/gi) || []) {
              const id = extractOfferId(possibleUrl);
              if (id) { offerId = id; finalUrl = possibleUrl; break; }
            }
          }
        }
      } catch {}
    }

    if (!offerId) {
      try {
        const resolved = await fetch(productUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" }
        });
        finalUrl = resolved.url || finalUrl;
        offerId = extractOfferId(finalUrl) || extractOfferId(await resolved.text());
      } catch {}
    }

    if (!offerId) {
      return Response.json({ success: false, error: "لم نتمكن من استخراج رقم منتج 1688 من الرابط المختصر", url: productUrl }, { status: 400, headers: cors });
    }

    const apiKey = context.env.PARSE_API_KEY;
    if (!apiKey) {
      return Response.json({ success: false, error: "PARSE_API_KEY غير مضبوط في Cloudflare" }, { status: 500, headers: cors });
    }

    const parseUrl = "https://api.parse.bot/scraper/bce3cd9b-591a-4e87-a406-6e57ab0dd092/get_product_details?offer_id=" + encodeURIComponent(offerId);
    const parseResponse = await fetch(parseUrl, {
      method: "GET",
      headers: { "X-API-Key": apiKey, "API-Snapshot-Version": "7" }
    });
    const parseData = await parseResponse.json();
    if (!parseResponse.ok) {
      return Response.json({ success: false, error: "فشل الاتصال بخدمة 1688", details: parseData }, { status: 502, headers: cors });
    }

    const data = parseData.data || parseData;
    return Response.json({
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
    }, { headers: cors });
  } catch (error) {
    return Response.json({ success: false, error: "حدث خطأ في جلب بيانات المنتج", details: error?.message || String(error) }, { status: 500, headers: cors });
  }
}
