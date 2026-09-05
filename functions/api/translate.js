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
          error: "Workers AI غير مربوط"
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
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "أنت مترجم محترف لأسماء المنتجات الصينية من 1688 إلى العربية. " +
              "ترجم اسم المنتج إلى العربية فقط. " +
              "لا تشرح. لا تضف مقدمة. لا تكرر الكلمات. " +
              "لا تكتب الصينية أو الإنجليزية. " +
              "حافظ على المعنى التجاري واسم المنتج مختصراً وواضحاً."
          },
          {
            role: "user",
            content:
              "ترجم اسم المنتج التالي إلى العربية فقط:\n" +
              text
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
        top_p: 0.8,
        repetition_penalty: 1.3
      }
    );

    let translated =
      String(result?.response || "").trim();

    // تنظيف أي مقدمات غير مرغوبة
    translated = translated
      .replace(/^الترجمة[:：]\s*/i, "")
      .replace(/^الترجمة العربية[:：]\s*/i, "")
      .replace(/^اسم المنتج[:：]\s*/i, "")
      .trim();

    // حذف الأسطر الزائدة
    translated = translated
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean)[0] || "";

    // لازم تكون النتيجة عربية
    const hasArabic = /[\u0600-\u06FF]/.test(translated);

    // منع تكرار نفس الكلمة مرات كثيرة
    const words = translated.split(/\s+/).filter(Boolean);

    const counts = {};

    for (const word of words) {
      counts[word] = (counts[word] || 0) + 1;
    }

    const repeatedWord = Object.values(counts)
      .some(count => count >= 4);

    if (!hasArabic || repeatedWord) {
      translated = "";
    }

    return new Response(
      JSON.stringify({
        success: Boolean(translated),
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
        error: "تعذر ترجمة اسم المنتج",
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