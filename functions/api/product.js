export async function onRequest(context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const json = (body, status = 200) =>
    Response.json(body, { status, headers: cors });

  const extractOfferId = (text) => {
    if (!text) return null;
    const match = String(text).match(/\/offer\/(\d{8,})/i) ||
      String(text).match(/offer(?:Id|_id)[=\/](\d{8,})/i) ||
      String(text).match(/\b(\d{10,})\b/);
    return match?.[1] || null;
  };

  try {
    const requestUrl = new URL(context.request.url);
    const inputText = requestUrl.searchParams.get("url");
    const urlMatch = inputText?.match(/https?:\/\/[^\s"'<>]+/i);

    if (!urlMatch) {
      return json({ success: false, error: "ضع رابط المنتج أو نص المشاركة الذي فيه الرابط" }, 400);
    }

    let productUrl = urlMatch[0].replace(/[)\]}>，。；;]+$/g, "");
    let parsedUrl;
    try {
      parsedUrl = new URL(productUrl);
    } catch {
      return json({ success: false, error: "الرابط غير صحيح" }, 400);
    }

    let host = parsedUrl.hostname.toLowerCase();
    const isTaobao = host.includes("taobao.com") || host.includes("tmall.com") || host.endsWith("tb.cn");
    const isPinduoduo = host.includes("yangkeduo.com") || host.includes("pinduoduo.com");
    const is1688 = host.includes("1688.com");

    if (!is1688 && !isTaobao && !isPinduoduo) {
      return json({ success: false, error: "الرابط لازم يكون من 1688 أو Taobao أو Pinduoduo" }, 400);
    }

    if (isTaobao) {
      let itemId = parsedUrl.searchParams.get("id") || productUrl.match(/\d{8,}/)?.[0];
      if (!itemId) {
        try {
          const share = await fetch(productUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
          const shareText = await share.text();
          const finalShareUrl = share.url || productUrl;
          itemId = new URL(finalShareUrl).searchParams.get("id") || finalShareUrl.match(/\d{8,}/)?.[0] || shareText.match(/(?:itemId|item_id|id)[^0-9]{0,20}(\d{8,})/i)?.[1];
        } catch {}
      }
      if (!itemId) return json({ success: false, error: "لم نجد رقم منتج Taobao في الرابط" }, 400);

      const parseKey = context.env.PARSE_API_KEY;
      if (!parseKey) return json({ success: false, error: "PARSE_API_KEY غير مضبوط في Cloudflare" }, 500);
      const response = await fetch("https://api.parse.bot/scraper/c09240ce-ae43-41b7-91ba-a8a2c7d2cb80/get_product_detail?item_id=" + encodeURIComponent(itemId), { headers: { "X-API-Key": parseKey } });
      const payload = await response.json();
      if (!response.ok) return json({ success: false, error: "فشل الاتصال بخدمة Taobao", details: payload }, 502);
      const data = payload.data || payload;
      return json({ success: true, platform: "Taobao", offer_id: itemId, source_url: productUrl, title: data.title || "", price: data.promotion_price || data.price || "", currency: "CNY", images: Array.isArray(data.images) ? data.images : [], detail_url: productUrl, raw: data });
    }

    if (isPinduoduo) {
      try {
        const response = await fetch(productUrl, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" } });
        const html = await response.text();
        const title = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || "";
        const image = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || "";
        if (!title) throw new Error("لم نتمكن من قراءة بيانات المنتج");
        return json({ success: true, platform: "Pinduoduo", offer_id: parsedUrl.searchParams.get("goods_id") || productUrl.match(/\d{8,}/)?.[0] || "", source_url: productUrl, title, price: "", currency: "CNY", images: image ? [image] : [], detail_url: productUrl, raw: {} });
      } catch (error) {
        return json({ success: false, error: "Pinduoduo منع قراءة رابط المنتج. جرّب رابط mobile.yangkeduo.com الكامل.", details: error?.message || String(error) }, 502);
      }
    }

    let offerId = extractOfferId(productUrl);
    let finalUrl = productUrl;
    const isQr1688 = host === "qr.1688.com" || host === "s.1688.com";

    // OneBound يفك روابط 1688 المختصرة ونصوص المشاركة التي تحجبها 1688 عن الخادم.
    if (!offerId && isQr1688) {
      const oneBoundKey = context.env.ONEBOUND_API_KEY;
      const oneBoundSecret = context.env.ONEBOUND_API_SECRET;
      if (!oneBoundKey || !oneBoundSecret) {
        return json({ success: false, error: "خدمة فك روابط 1688 غير مضبوطة بعد" }, 500);
      }

      const resolverUrl = new URL("https://api-gw.onebound.cn/1688/item_password/");
      resolverUrl.searchParams.set("key", oneBoundKey);
      resolverUrl.searchParams.set("secret", oneBoundSecret);
      resolverUrl.searchParams.set("word", productUrl);
      resolverUrl.searchParams.set("title", "no");

      const resolverResponse = await fetch(resolverUrl);
      const resolverData = await resolverResponse.json();
      if (!resolverResponse.ok || resolverData?.error_code) {
        return json({ success: false, error: "فشل فك رابط 1688 المختصر", details: resolverData }, 502);
      }

      const resolvedText = JSON.stringify(resolverData);
      const resolvedUrl = resolverData?.item?.url || resolverData?.data?.url || resolverData?.url || "";
      finalUrl = resolvedUrl || finalUrl;
      offerId = extractOfferId(resolvedUrl) || extractOfferId(resolvedText);
      if (!offerId) {
        return json({ success: false, error: "لم نجد رقم المنتج بعد فك رابط 1688", details: resolverData }, 502);
      }
    }

    // الروابط العادية من 1688 يمكن تحويلها مباشرة إن لم تحمل رقم العرض.
    if (!offerId && !isQr1688) {
      try {
        const resolved = await fetch(productUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
        finalUrl = resolved.url || finalUrl;
        offerId = extractOfferId(finalUrl) || extractOfferId(await resolved.text());
      } catch {}
    }

    const parseKey = context.env.PARSE_API_KEY;
    if (!parseKey) return json({ success: false, error: "PARSE_API_KEY غير مضبوط في Cloudflare" }, 500);

    const detailsUrl = "https://api.parse.bot/scraper/bce3cd9b-591a-4e87-a406-6e57ab0dd092/get_product_details?offer_id=" + encodeURIComponent(offerId || productUrl);
    const response = await fetch(detailsUrl, { headers: { "X-API-Key": parseKey } });
    const payload = await response.json();
    if (!response.ok) return json({ success: false, error: "فشل جلب بيانات منتج 1688", details: payload }, 502);

    const data = payload.data || payload;
    return json({
      success: true,
      platform: "1688",
      offer_id: offerId || "",
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
    });
  } catch (error) {
    return json({ success: false, error: "حدث خطأ في جلب بيانات المنتج", details: error?.message || String(error) }, 500);
  }
}
