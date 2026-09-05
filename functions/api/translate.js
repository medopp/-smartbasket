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

    // =====================================
    // 1 - Argos / LibreTranslate
    // =====================================

    try {
      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 8000);

      const response = await fetch(
        "https://translate.argosopentech.com/translate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            q: text,
            source: "zh",
            target: "ar"
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();

        if (
          data?.translatedText &&
          /[\u0600-\u06FF]/.test(
            data.translatedText
          )
        ) {
          translated =
            String(data.translatedText).trim();
        }
      }

    } catch (error) {
      translated = "";
    }


    // =====================================
    // 2 - MyMemory
    // =====================================

    if (!translated) {

      try {

        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 8000);

        const url =
          "https://api.mymemory.translated.net/get" +
          "?q=" +
          encodeURIComponent(text) +
          "&langpair=zh-CN|ar" +
          "&mt=1";

        const response = await fetch(url, {
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {

          const data = await response.json();

          const result =
            data?.responseData?.translatedText;

          if (
            result &&
            /[\u0600-\u06FF]/.test(result)
          ) {
            translated =
              String(result).trim();
          }
        }

      } catch (error) {
        translated = "";
      }
    }


    // =====================================
    // 3 - Google
    // =====================================

    if (!translated) {

      try {

        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 8000);

        const url =
          "https://translate.googleapis.com/translate_a/single" +
          "?client=gtx" +
          "&sl=zh" +
          "&tl=ar" +
          "&dt=t" +
          "&q=" +
          encodeURIComponent(text);

        const response = await fetch(url, {
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {

          const data = await response.json();

          if (Array.isArray(data?.[0])) {

            const result = data[0]
              .map(item => item?.[0] || "")
              .join("")
              .trim();

            if (
              result &&
              /[\u0600-\u06FF]/.test(result)
            ) {
              translated = result;
            }
          }
        }

      } catch (error) {
        translated = "";
      }
    }


    // =====================================
    // النتيجة النهائية
    // =====================================

    if (
      !translated ||
      !/[\u0600-\u06FF]/.test(translated)
    ) {
      translated = "منتج من 1688";
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
        error: "تعذر ترجمة النص"
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