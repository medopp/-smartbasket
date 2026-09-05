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

    const text = String(
      body?.text ||
      body?.texts?.[0] ||
      ""
    ).trim();

    if (!text) {
      return new Response(
        JSON.stringify({
          success: true,
          original: "",
          translated: ""
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

    let translated = "";

    // Google Translate
    try {
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx" +
        "&sl=auto" +
        "&tl=ar" +
        "&dt=t" +
        "&q=" +
        encodeURIComponent(text);

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        if (Array.isArray(data?.[0])) {
          translated = data[0]
            .map(item => item?.[0] || "")
            .join("")
            .trim();
        }
      }
    } catch (error) {
      translated = "";
    }

    // MyMemory fallback
    if (
      !translated ||
      !/[\u0600-\u06FF]/.test(translated)
    ) {
      try {
        const url =
          "https://api.mymemory.translated.net/get" +
          "?q=" +
          encodeURIComponent(text) +
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
            translated = result.trim();
          }
        }
      } catch (error) {
        translated = "";
      }
    }

    if (!translated) {
      translated = text;
    }

    return new Response(
      JSON.stringify({
        success: true,
        original: text,
        translated: translated
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