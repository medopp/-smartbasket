const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequest(context) {
  const { request, env } = context;

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

    if (!env.AI) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Workers AI غير مربوط بالموقع"
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

    const result = await env.AI.run(
      "@cf/meta/m2m100-1.2b",
      {
        text: text,
        source_lang: "zh",
        target_lang: "ar"
      }
    );

    const translated =
      String(
        result?.translated_text ||
        result?.translation ||
        ""
      ).trim();

    if (!translated) {
      return new Response(
        JSON.stringify({
          success: false,
          original: text,
          translated: ""
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