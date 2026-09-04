export async function onRequest(context) {
  const url = new URL(context.request.url);
  const productUrl = url.searchParams.get("url");

  if (!productUrl) {
    return Response.json(
      { success: false, error: "ضع رابط المنتج" },
      { status: 400 }
    );
  }

  let parsed;

  try {
    parsed = new URL(productUrl);
  } catch {
    return Response.json(
      { success: false, error: "الرابط غير صحيح" },
      { status: 400 }
    );
  }

  const host = parsed.hostname.toLowerCase();

  let platform = null;

  if (host.includes("1688.com")) {
    platform = "1688";
  } else if (host.includes("taobao.com")) {
    platform = "taobao";
  } else if (host.includes("pinduoduo.com") || host.includes("yangkeduo.com")) {
    platform = "pinduoduo";
  } else if (host.includes("shein.com")) {
    platform = "shein";
  }

  if (!platform) {
    return Response.json(
      {
        success: false,
        error: "المنصة غير مدعومة",
        supported: ["1688", "taobao", "pinduoduo", "shein"]
      },
      { status: 400 }
    );
  }

  return Response.json({
    success: true,
    platform,
    url: productUrl,
    message: "تم التعرف على المنصة بنجاح"
  });
}
