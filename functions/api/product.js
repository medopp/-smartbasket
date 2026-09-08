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

    // استخراج رابط 1688 من النص حتى لو كان النص يحتوي على كلام صيني
    const urlMatch = inputText.match(
      /https?:\/\/[^\s"'<>]+/i
    );

    if (!urlMatch) {
      return Response.json(
        { success: false, error: "لم نجد رابط 1688 داخل النص" },
        { status: 400, headers: cors }
      );
    }

    let productUrl = urlMatch[0]
      .replace(/[)\]}>，。；;]+$/g, "");

    let resolvedProductUrl = productUrl;     try {       const shortHost = new URL(productUrl).hostname.toLowerCase();       if (shortHost.endsWith("tb.cn") || false) {         const redirectResponse = await fetch(productUrl, {           redirect: "follow",           headers: { "User-Agent": "Mozilla/5.0" }         });         if (redirectResponse.url) resolvedProductUrl = redirectResponse.url;       }     } catch {}     productUrl = resolvedProductUrl;      let parsedUrl;

    try {
      parsedUrl = new URL(productUrl);
    } catch {
      return Response.json(
        { success: false, error: "الرابط غير صحيح" },
        { status: 400, headers: cors }
      );
    }

    const host = parsedUrl.hostname.toLowerCase();    const isTaobao = host.includes("taobao.com") || host.includes("tmall.com") || host.endsWith("tb.cn");    const isPinduoduo = host.includes("yangkeduo.com") || host.includes("pinduoduo.com");    if (!host.includes("1688.com") && !isTaobao && !isPinduoduo) {      return Response.json(        { success: false, error: "الرابط لازم يكون من 1688 أو Taobao أو Pinduoduo" },        { status: 400, headers: cors }      );    }    if (isTaobao) {      let itemId = parsedUrl.searchParams.get("id") || productUrl.match(/\d{8,}/)?.[0];
      if (!itemId) {
        try {
          const share = await fetch(productUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
          const shareText = await share.text();
          const finalShareUrl = share.url || productUrl;
          itemId = new URL(finalShareUrl).searchParams.get("id") || finalShareUrl.match(/\d{8,}/)?.[0] || shareText.match(/(?:itemId|item_id|id)[^0-9]{0,20}(\d{8,})/i)?.[1] || shareText.match(/(?:id%3D|id=)(\d{8,})/i)?.[1];
        } catch {}
      }      if (!itemId) return Response.json({ success:false, error:"لم نجد رقم منتج Taobao في الرابط" }, { status:400, headers:cors });      const apiKey = context.env.PARSE_API_KEY;      if (!apiKey) return Response.json({ success:false, error:"PARSE_API_KEY غير مضبوط في Cloudflare" }, { status:500, headers:cors });      const response = await fetch("https://api.parse.bot/scraper/c09240ce-ae43-41b7-91ba-a8a2c7d2cb80/get_product_detail?item_id=" + encodeURIComponent(itemId), { headers:{ "X-API-Key":apiKey } });      const parsed = await response.json();      if (!response.ok) return Response.json({ success:false, error:"فشل الاتصال بخدمة Taobao", details:parsed }, { status:502, headers:cors });      const data = parsed.data || parsed;      return Response.json({ success:true, platform:"Taobao", offer_id:itemId, source_url:productUrl, title:data.title || "", price:data.promotion_price || data.price || "", currency:"CNY", images:Array.isArray(data.images) ? data.images : [], detail_url:productUrl, raw:data }, { headers:cors });    }    if (isPinduoduo) {      try {        const response = await fetch(productUrl, { headers:{ "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", "Accept":"text/html,application/xhtml+xml" } });        const html = await response.text();        const meta = name => html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)', 'i'))?.[1] || "";        const title = meta("og:title") || html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || "";        const image = meta("og:image");        const price = html.match(/(?:price|group_price)["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i)?.[1] || "";        if (!title) throw new Error("لم نتمكن من قراءة بيانات المنتج");        return Response.json({ success:true, platform:"Pinduoduo", offer_id:parsedUrl.searchParams.get("goods_id") || productUrl.match(/\d{8,}/)?.[0] || "", source_url:productUrl, title, price, currency:"CNY", images:image ? [image] : [], detail_url:productUrl, raw:{} }, { headers:cors });      } catch (error) {        return Response.json({ success:false, error:"Pinduoduo منع قراءة رابط المنتج. جرّب رابط mobile.yangkeduo.com الكامل.", details:error?.message || String(error) }, { status:502, headers:cors });      }    }

    if (
      !host.includes("1688.com")
    ) {
      return Response.json(
        { success: false, error: "الرابط ليس رابط 1688" },
        { status: 400, headers: cors }
      );
    }

    let offerId = null;
    let finalUrl = productUrl;

    // --------------------------------------------------
    // 1. محاولة استخراج رقم المنتج مباشرة من الرابط
    // --------------------------------------------------

    function extractOfferId(text) {
      if (!text) return null;

      const patterns = [
        /\/offer\/(\d{8,})/i,
        /offerId[=\/](\d{8,})/i,
        /offer_id[=\/](\d{8,})/i
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
      }

      // آخر محاولة: أي رقم طويل يشبه رقم منتج 1688
      const numbers = text.match(/\d{10,}/g);

      if (numbers && numbers.length) {
        return numbers[0];
      }

      return null;
    }

    offerId = extractOfferId(productUrl);

    // --------------------------------------------------
    // 2. إذا كان رابط QR مختصر، نحاول فك التحويل
    // --------------------------------------------------

    if (!offerId) {
      try {
        const shortResponse = await fetch(productUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        });

        const location =
          shortResponse.headers.get("location");

        if (location) {
          try {
            finalUrl = new URL(
              location,
              productUrl
            ).toString();
          } catch {}
        }

        offerId = extractOfferId(finalUrl);

        // --------------------------------------------------
        // 3. لو لم يظهر في Location، نقرأ الصفحة نفسها
        // --------------------------------------------------

        if (!offerId) {
          const html = await shortResponse.text();

          offerId = extractOfferId(html);

          if (!offerId) {
            const htmlUrlMatch = html.match(
              /https?:\/\/[^"'<>\\\s]+/gi
            );

            if (htmlUrlMatch) {
              for (const possibleUrl of htmlUrlMatch) {
                const id = extractOfferId(possibleUrl);

                if (id) {
                  offerId = id;
                  finalUrl = possibleUrl;
                  break;
                }
              }
            }
          }
        }
      } catch {}
    }

    // --------------------------------------------------
    // 4. محاولة ثانية باستخدام redirect follow
    // --------------------------------------------------

    if (!offerId) {
      try {
        const resolved = await fetch(productUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
          }
        });

        if (resolved.url) {
          finalUrl = resolved.url;
          offerId = extractOfferId(finalUrl);
        }

        if (!offerId) {
          const html = await resolved.text();
          offerId = extractOfferId(html);
        }
      } catch {}
    }

    // --------------------------------------------------
    // 5. إذا فشل استخراج رقم المنتج
    // --------------------------------------------------

    // تمرير رابط QR للخدمة كحل أخير؛ الخدمة تقبل رابط المنتج الكامل أيضاً.
    const parseInput = offerId || productUrl;

    // --------------------------------------------------
    // 6. Parse API
    // --------------------------------------------------

    const apiKey = context.env.PARSE_API_KEY;

    if (!apiKey) {
      return Response.json(
        {
          success: false,
          error:
            "PARSE_API_KEY غير مضبوط في Cloudflare"
        },
        { status: 500, headers: cors }
      );
    }

    const parseUrl =
      "https://api.parse.bot/scraper/bce3cd9b-591a-4e87-a406-6e57ab0dd092/get_product_details" +
      "?offer_id=" +
      encodeURIComponent(parseInput);

    const parseResponse = await fetch(parseUrl, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "API-Snapshot-Version": "7"
      }
    });

    const parseBody = await parseResponse.text();     let parseData;     try {       parseData = JSON.parse(parseBody);     } catch {       parseData = { message: parseBody.slice(0, 300) || "استجابة غير صالحة من خدمة 1688" };     }

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
        offer_id: offerId || "",
        source_url: productUrl,

        title: data.title || "",

        price:
          data.price_display ||
          data.min_price ||
          data.price ||
          "",

        min_price: data.min_price || "",
        max_price: data.max_price || "",

        currency: "CNY",
        unit: data.unit || "",
        moq: data.moq ?? null,

        company_name: data.company_name || "",
        province: data.province || "",
        city: data.city || "",

        images:
          Array.isArray(data.images)
            ? data.images
            : [],

        detail_url:
          data.detail_url ||
          finalUrl,

        raw: data
      },
      { headers: cors }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "حدث خطأ في جلب بيانات المنتج",
        details:
          error?.message ||
          String(error)
      },
      { status: 500, headers: cors }
    );
  }
}
