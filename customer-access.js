(() => {
  const emailForCode = code => "customer-" + String(code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") + "@accounts.smartbasket.local";

  function setLoginScreen() {
    const modal = document.querySelector(".auth-modal");
    if (!modal) return;
    modal.querySelector("h2").textContent = "تسجيل الدخول";
    modal.querySelector("p").textContent = "أدخل بيانات الحساب الخاصة بك.";
    document.getElementById("emailRegisterTab")?.parentElement?.remove();
    const fields = modal.querySelectorAll(".auth-field");
    if (fields[0]) fields[0].querySelector("label").textContent = "بيانات الدخول";
    const input = document.getElementById("emailInput");
    if (input) {
      input.type = "text";
      input.placeholder = "اكتب كود العميل أو البريد";
      input.autocomplete = "username";
    }
    const main = modal.querySelector('.auth-main[onclick="emailAuthContinue()"]');
    if (main) main.textContent = "تسجيل الدخول";
    modal.querySelector('.auth-main[onclick="sendPasswordReset()"]')?.remove();
    document.getElementById("otpArea")?.remove();
    const status = document.getElementById("authStatus");
    if (status) status.textContent = "الحسابات تُنشأ من الشركة فقط.";
  }

  window.emailAuthContinue = async () => {
    const identifier = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passwordInput").value;
    if (!identifier || !password) return window.setAuthStatus("اكتب بيانات الدخول وكلمة المرور.", true);
    const email = identifier.includes("@")
      ? identifier.toLowerCase()
      : (/^[A-Z]{2,8}-\d{3,10}$/.test(identifier.toUpperCase()) ? emailForCode(identifier) : null);
    if (!email) return window.setAuthStatus("كود العميل مثال: LN-1010", true);
    window.setAuthStatus("جاري تسجيل الدخول...");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return window.setAuthStatus("بيانات الدخول غير صحيحة.", true);
    window.closeAuth();
    window.syncAccountButton(data.user);
  };

  window.createCustomer = async () => {
    const fullName = document.getElementById("customerName").value.trim();
    const customerCode = document.getElementById("customerCode").value.trim().toUpperCase();
    const password = document.getElementById("customerPassword").value;
    const phone = document.getElementById("customerPhone").value.trim();
    const result = document.getElementById("customerCreateResult");
    if (!customerCode || !password) {
      result.textContent = "اكتب كود العميل وكلمة المرور.";
      return;
    }
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      result.textContent = "سجل دخول المدير أولاً.";
      return;
    }
    result.textContent = "جاري إنشاء الحساب...";
    try {
      const response = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ fullName, customerCode, password, phone })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر إنشاء الحساب");
      result.textContent = "تم إنشاء العميل " + payload.customerCode + ". أعطِه الكود وكلمة المرور.";
      document.getElementById("customerPassword").value = "";
    } catch (error) {
      result.textContent = error.message || "تعذر إنشاء الحساب.";
    }
  };

  function addCustomerCard() {
    const grid = document.querySelector("#adminPanel .admin-grid");
    if (!grid || document.getElementById("customerCode")) return;
    const card = document.createElement("article");
    card.className = "admin-card";
    card.innerHTML = '<div class="card-title"><span>👤</span><div><b>إضافة عميل</b><small>أنشئ حساباً للعميل ثم أعطه الكود وكلمة المرور</small></div></div><input id="customerName" class="customer-field" placeholder="اسم العميل (اختياري)"><input id="customerCode" class="customer-field" placeholder="كود العميل: LN-1010" style="text-transform:uppercase"><input id="customerPassword" class="customer-field" type="password" placeholder="كلمة المرور (8 أحرف على الأقل)"><input id="customerPhone" class="customer-field" placeholder="رقم الهاتف (اختياري)"><button onclick="createCustomer()">إضافة العميل</button><small id="customerCreateResult" class="customer-result"></small>';
    grid.appendChild(card);
    const style = document.createElement("style");
    style.textContent = ".customer-field{width:100%;margin:0 0 9px;padding:10px;border:1px solid #2d3b4a;border-radius:9px;background:#0f1720;color:#fff}.customer-result{display:block;min-height:18px;margin-top:10px;color:#d8ff42;line-height:1.5}";
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setLoginScreen();
    addCustomerCard();
  });
})();
