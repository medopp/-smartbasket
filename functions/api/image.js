export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const imageUrl = requestUrl.searchParams.get("url");

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (!imageUrl) {
    return new Response("Missing image URL", {
      status: 400,
      headers: cors
    });
  }

  try {
    const target = new URL(imageUrl);

    if (!target.hostname.endsWith("alicdn.com")) {
      return new Response("Invalid image source", {
        status: 403,
        headers: cors
      });
    }

    const response = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      return new Response("Image fetch failed", {
        status: 502,
        headers: cors
      });
    }

    const headers = new Headers(cors);
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") || "image/jpeg"
    );
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(response.body, {
      status: 200,
      headers
    });

  } catch (error) {
    return new Response("Invalid image URL", {
      status: 400,
      headers: cors
    });
  }
}