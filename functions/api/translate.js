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

    const texts = Array.isArray(body.texts)
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

    const uniqueTexts = [
      ...new Set(
        texts
          .map(x => String(x || "").trim())
          .filter(Boolean)
      )
    ];

    const translatedMap = {};

    await Promise.all(
      uniqueTexts.map(async text => {
        try {
          const url =
            "https://api.mymemory.translated.net/get" +
            "?q=" +
            encodeURIComponent(text) +
            "&langpair=zh-CN|ar";

          const response = await fetch(url);

          if (!response.ok) {
            translatedMap[text] = text;
            return;
          }

          const data = await response.json();

          const translated =
            data?.responseData?.translatedText;

          translatedMap[text] =
            translated && translated.trim()
              ? translated
              : text;

        } catch (error) {
          translatedMap[text] = text;
        }
      })
    );

    const translated = texts.map(text => {
      const key = String(text || "").trim();

      return translatedMap[key] || text;
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