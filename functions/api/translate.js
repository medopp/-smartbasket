export async function onRequest(context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (context.request.method !== "POST") {
    return Response.json(
      { success: false, error: "POST فقط" },
      { status: 405, headers: cors }
    );
  }

  try {
    const body = await context.request.json();

    let texts = body.texts;

    if (!Array.isArray(texts)) {
      texts = [body.text || ""];
    }

    texts = texts
      .map(x => String(x || "").trim())
      .filter(Boolean);

    if (!texts.length) {
      return Response.json(
        { success: false, error: "النص فارغ" },
        { status: 400, headers: cors }
      );
    }

    const translated = await Promise.all(
      texts.map(async text => {
        try {
          const url =
            "https://translate.googleapis.com/translate_a/single" +
            "?client=gtx" +
            "&sl=zh-CN" +
            "&tl=ar" +
            "&dt=t" +
            "&q=" +
            encodeURIComponent(text);

          const response = await fetch(url);

          if (!response.ok) return text;

          const data = await response.json();

          const result = Array.isArray(data?.[0])
            ? data[0]
                .map(item => item?.[0] || "")
                .join("")
            : "";

          return result || text;

        } catch {
          return text;
        }
      })
    );

    return Response.json(
      {
        success: true,
        original: texts,
        translated
      },
      { headers: cors }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "تعذر ترجمة النص",
        details: error?.message || String(error)
      },
      { status: 500, headers: cors }
    );
  }
}