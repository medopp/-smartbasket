const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors
    });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "POST فقط"
      }),
      {
        status: 405,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    const body = await request.json();

    const texts = Array.isArray(body?.texts)
      ? body.texts
      : [];

    if (!texts.length) {
      return new Response(
        JSON.stringify({
          success: true,
          original: [],
          translated: []
        }),
        {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": "application/json"
          }
        }
      );
    }

    const originalTitle = String(texts[0] || "").trim();

    let translatedTitle = "";

    // Google Translate
    try {
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx" +
        "&sl=zh-CN" +
        "&tl=ar" +
        "&dt=t" +
        "&q=" +
        encodeURIComponent(originalTitle);

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        if (Array.isArray(data?.[0])) {
          translatedTitle = data[0]
            .map(item => item?.[0] || "")
            .join("")
            .trim();
        }
      }
    } catch (error) {
      translatedTitle = "";
    }

    // MyMemory fallback
    if (!translatedTitle || !/[\u0600-\u06FF]/.test(translatedTitle)) {
      try {
        const url =
          "https://api.mymemory.translated.net/get" +
          "?q=" +
          encodeURIComponent(originalTitle) +
          "&langpair=zh-CN|ar";

        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();

          const result =
            data?.responseData?.translatedText;

          if (
            result &&
            /[\u0600-\u06FF]/.test(result)
          ) {
            translatedTitle = result.trim();
          }
        }
      } catch (error) {
        translatedTitle = "";
      }
    }

    if (!translatedTitle) {
      translatedTitle = originalTitle;
    }

    // الاسم الأول هو اسم المنتج.
    // باقي القيم نخليها كما هي لأن الموقع
    // يترجم الألوان والمقاسات محلياً.
    const translated = texts.map((text, index) => {
      if (index === 0) {
        return translatedTitle;
      }

      return text;
    });

    return new Response(
      JSON.stringify({
        success: true,
        original: texts,
        translated
      }),
      {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "تعذر ترجمة النص",
        details: error?.message || String(error)
      }),
      {
        status: 500,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      }
    );
  }
}