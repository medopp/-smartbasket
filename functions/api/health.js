export async function onRequest() {
  return new Response(
    JSON.stringify({
      success: true,
      service: "Smart Basket API"
    }),
    {
      headers: {
        "content-type": "application/json;charset=UTF-8"
      }
    }
  );
}
