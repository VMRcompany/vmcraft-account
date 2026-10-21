(function () {
  const PROFILE_KEY = "vmcraft-profile";
  const FLOW_KEY = "vmcraft-ms-flow";
  const signedOut = document.getElementById("accountSignedOut");
  const signedIn = document.getElementById("accountSignedIn");
  if (!signedOut || !signedIn) return;

  const statusEl = document.getElementById("accountStatus");
  const setupEl = document.getElementById("accountSetup");
  const fieldsEl = document.getElementById("accountFields");
  const skinEl = document.getElementById("skinImg");
  const playsEl = document.getElementById("playsVMcraft");
  const signInBtn = document.getElementById("msSignIn");
  let statusText = "";

  function t(key) {
    const pack = window.vmcraftT && window.vmcraftT();
    return (pack && pack[key]) || "";
  }

  function clientId() {
    const cfg = window.VMCRAFT_MS || {};
    return String(cfg.clientId || "").trim();
  }

  function redirectUri() {
    return new URL("account.html", window.location.href).href.split(/[?#]/)[0];
  }

  function b64url(bytes) {
    let str = "";
    bytes.forEach(function (b) { str += String.fromCharCode(b); });
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomUrl(size) {
    const buf = new Uint8Array(size);
    crypto.getRandomValues(buf);
    return b64url(buf);
  }

  async function challenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return b64url(new Uint8Array(buf));
  }

  function decodeJwt(token) {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = part + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(pad));
  }

  function loadProfile() {
    return window.vmcraftReadProfile ? window.vmcraftReadProfile() : null;
  }

  function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    if (typeof refreshAccountLink === "function") refreshAccountLink();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(value) {
    return value ? escapeHtml(value) : escapeHtml(t("unknown"));
  }

  function yn(value) {
    if (value === true) return escapeHtml(t("yes"));
    if (value === false) return escapeHtml(t("no"));
    return escapeHtml(t("unknown"));
  }

  function setStatus(text) {
    statusText = text || "";
    if (statusEl) statusEl.textContent = statusText;
  }

  window.renderAccount = function () {
    const profile = loadProfile();
    const hasAccount = !!(profile && profile.microsoft);
    signedOut.hidden = hasAccount;
    signedIn.hidden = !hasAccount;
    if (setupEl) {
      const missing = !clientId();
      setupEl.hidden = !missing;
      setupEl.textContent = missing ? t("accountNeedClient") : "";
    }
    if (!hasAccount) {
      if (statusEl) statusEl.textContent = statusText;
      return;
    }
    const ms = profile.microsoft || {};
    const xb = profile.xbox || {};
    const mc = profile.minecraft || {};
    const skin = mc.skins && mc.skins[0] && mc.skins[0].url;
    if (skinEl) {
      skinEl.hidden = !skin;
      if (skin) {
        skinEl.src = skin;
        skinEl.alt = mc.name || "Minecraft";
      } else {
        skinEl.removeAttribute("src");
      }
    }
    if (fieldsEl) {
      const rows = [
        [t("fieldName"), dash(ms.name)],
        [t("fieldEmail"), dash(ms.email)],
        [t("fieldId"), dash(ms.id)],
        [t("fieldGamertag"), dash(xb.gamertag)],
        [t("fieldXuid"), dash(xb.xuid)],
        [t("fieldMcName"), dash(mc.name)],
        [t("fieldUuid"), dash(mc.id)],
        [t("fieldJava"), yn(mc.ownsJava)],
        [t("fieldPlays"), yn(profile.playsVMcraft)]
      ];
      fieldsEl.innerHTML = rows.map(function (pair) {
        return "<dt>" + escapeHtml(pair[0]) + "</dt><dd>" + pair[1] + "</dd>";
      }).join("");
    }
    if (playsEl) playsEl.checked = profile.playsVMcraft === true;
    if (statusEl) statusEl.textContent = statusText || profile.note || "";
  };

  if (signInBtn) {
    signInBtn.addEventListener("click", async function () {
      if (!clientId()) {
        setStatus(t("accountNeedClient"));
        window.renderAccount();
        return;
      }
      if (location.protocol === "file:") {
        setStatus(t("accountNeedHttps"));
        return;
      }
      const verifier = randomUrl(32);
      const state = randomUrl(16);
      sessionStorage.setItem(FLOW_KEY, JSON.stringify({ verifier: verifier, state: state }));
      const params = new URLSearchParams({
        client_id: clientId(),
        response_type: "code",
        redirect_uri: redirectUri(),
        response_mode: "query",
        scope: "openid profile email XboxLive.signin",
        state: state,
        code_challenge: await challenge(verifier),
        code_challenge_method: "S256",
        prompt: "select_account"
      });
      location.assign("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?" + params.toString());
    });
  }

  const signOutBtn = document.getElementById("msSignOut");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", function () {
      localStorage.removeItem(PROFILE_KEY);
      sessionStorage.removeItem(FLOW_KEY);
      statusText = "";
      if (typeof refreshAccountLink === "function") refreshAccountLink();
      window.renderAccount();
    });
  }

  if (playsEl) {
    playsEl.addEventListener("change", function () {
      const profile = loadProfile();
      if (!profile) return;
      profile.playsVMcraft = playsEl.checked;
      saveProfile(profile);
      window.renderAccount();
    });
  }

  function xboxIdentity(xbl, xui) {
    const claim = xui || (xbl.DisplayClaims && xbl.DisplayClaims.xui && xbl.DisplayClaims.xui[0]) || {};
    return {
      gamertag: claim.gtg || "",
      xuid: claim.xid || "",
      userhash: claim.uhs || ""
    };
  }

  function xboxMessage(body) {
    const code = body && body.XErr;
    if (code === 2148916233) return t("mcNoXbox");
    if (code === 2148916238) return t("mcChild");
    if (body && body.Message) return String(body.Message);
    return t("mcCors");
  }

  async function minecraftProfile(accessToken) {
    const xblRes = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: "d=" + accessToken
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT"
      })
    });
    if (!xblRes.ok) {
      const body = await xblRes.json().catch(function () { return {}; });
      return { xbox: null, minecraft: null, note: xboxMessage(body) };
    }
    const xbl = await xblRes.json();
    const uhs = xbl.DisplayClaims && xbl.DisplayClaims.xui && xbl.DisplayClaims.xui[0] && xbl.DisplayClaims.xui[0].uhs;
    const xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        Properties: { SandboxId: "RETAIL", UserTokens: [xbl.Token] },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT"
      })
    });
    const xsts = await xstsRes.json().catch(function () { return {}; });
    if (!xstsRes.ok) {
      return { xbox: xboxIdentity(xbl), minecraft: null, note: xboxMessage(xsts) };
    }
    const xui = xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0];
    const mcRes = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identityToken: "XBL3.0 x=" + uhs + ";" + xsts.Token })
    });
    const mcAuth = await mcRes.json().catch(function () { return {}; });
    if (!mcRes.ok || !mcAuth.access_token) {
      return { xbox: xboxIdentity(xbl, xui), minecraft: null, note: mcAuth.errorMessage || t("mcNoProfile") };
    }
    const headers = { Authorization: "Bearer " + mcAuth.access_token, Accept: "application/json" };
    const profRes = await fetch("https://api.minecraftservices.com/minecraft/profile", { headers: headers });
    const entRes = await fetch("https://api.minecraftservices.com/entitlements/mcstore", { headers: headers });
    const prof = profRes.ok ? await profRes.json() : null;
    const ent = entRes.ok ? await entRes.json() : null;
    const items = (ent && ent.items) || [];
    const ownsJava = items.some(function (item) {
      return item && (item.name === "product_minecraft" || item.name === "game_minecraft");
    });
    return {
      xbox: xboxIdentity(xbl, xui),
      minecraft: prof ? {
        id: prof.id,
        name: prof.name,
        skins: (prof.skins || []).map(function (skin) { return { url: skin.url, variant: skin.variant }; }),
        capes: (prof.capes || []).map(function (cape) { return cape.alias; }),
        ownsJava: ownsJava
      } : { ownsJava: ownsJava },
      note: prof ? "" : t("mcNoProfile")
    };
  }

  async function finishSignIn() {
    const url = new URL(window.location.href);
    const err = url.searchParams.get("error");
    const errText = url.searchParams.get("error_description");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!err && !code) return;
    history.replaceState({}, "", url.pathname);
    if (err) {
      setStatus(errText || err);
      return;
    }
    let flow = null;
    try { flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) || "null"); } catch (e) { flow = null; }
    sessionStorage.removeItem(FLOW_KEY);
    if (!flow || flow.state !== state || !flow.verifier) {
      setStatus(t("accountState"));
      return;
    }
    setStatus(t("accountWorking"));
    const tokenRes = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri(),
        code_verifier: flow.verifier
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      setStatus(tokenJson.error_description || tokenJson.error || t("unknown"));
      return;
    }
    const claims = tokenJson.id_token ? decodeJwt(tokenJson.id_token) : {};
    const accountId = claims.oid || claims.sub || "";
    const previous = loadProfile();
    const sameAccount = previous && previous.microsoft && previous.microsoft.id === accountId;
    const profile = {
      microsoft: {
        id: accountId,
        name: claims.name || "",
        email: claims.email || claims.preferred_username || ""
      },
      xbox: null,
      minecraft: null,
      playsVMcraft: sameAccount ? previous.playsVMcraft === true : false,
      note: ""
    };
    try {
      const game = await minecraftProfile(tokenJson.access_token);
      profile.xbox = game.xbox;
      profile.minecraft = game.minecraft;
      profile.note = game.note || "";
    } catch (e) {
      profile.note = t("mcCors");
    }
    saveProfile(profile);
    statusText = profile.note || "";
  }

  finishSignIn().catch(function () {
    setStatus(t("mcCors"));
  }).then(function () {
    if (window.renderAccount) window.renderAccount();
  });
})();
