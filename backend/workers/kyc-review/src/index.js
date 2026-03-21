const FIRESTORE_HOST = "https://firestore.googleapis.com/v1";

export default {
  async fetch(request, env) {
    const origin = pickOrigin(env, request.headers.get("Origin"));

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, origin);
    }

    let payload;
    try {
    payload = await request.json();
    console.log("[kyc-review] incoming payload:", payload);
    } catch (_) {
      return json({ error: "invalid_json" }, 400, origin);
    }

    const { uid, action, note = "", key } = payload || {};

    if (!key || key !== env.ADMIN_REVIEW_KEY) {
      return json({ error: "forbidden" }, 403, origin);
    }
    if (!uid || !["approve", "reject"].includes(action)) {
      return json({ error: "invalid_payload" }, 400, origin);
    }

    try {
      const token = await getAccessToken(env);
      await updateVerifyStatus({
        env,
        token,
        uid,
        action,
        note,
      });
      return json({ ok: true }, 200, origin);
    } catch (err) {
      console.error("KYC worker error:", err);
      return json(
        { error: "internal_error", detail: err.message || String(err) },
        500,
        origin
      );
    }
  },
};

function pickOrigin(env, requestOrigin) {
  const cfg = (env.CORS_ORIGIN || "*").trim();
  if (cfg === "*" || !requestOrigin) return cfg || "*";
  const allowed = cfg.split(",").map((s) => s.trim());
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || "*";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

async function updateVerifyStatus({ env, token, uid, action, note }) {
  const projectId =
    env.FIREBASE_PROJECT_ID ||
    env.FIREBASE_PROJECT ||
    env.FIREBASE_PROJECT_ID_DEFAULT;
  if (!projectId) throw new Error("missing_project_id");

  const status = action === "approve" ? "approved" : "rejected";
  const timestampValue = new Date().toISOString();

  const body = {
    fields: {
      verify: {
        mapValue: {
          fields: {
            status: { stringValue: status },
            reviewNote: { stringValue: note || "" },
            reviewedAt: { timestampValue },
          },
        },
      },
    },
  };

  const url = `${FIRESTORE_HOST}/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(
    uid
  )}?updateMask.fieldPaths=verify`;

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`firestore_error:${resp.status}:${text}`);
  }
}

async function getAccessToken(env) {
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(env.FIREBASE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error("missing_service_account");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    scope:
      "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signingInput = [
    base64UrlEncode(JSON.stringify(header)),
    base64UrlEncode(JSON.stringify(payload)),
  ].join(".");

  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`token_exchange_failed:${text}`);
  }

  const result = await tokenResp.json();
  if (!result.access_token) throw new Error("missing_access_token");
  return result.access_token;
}

function normalizePrivateKey(key) {
  if (!key) return "";
  return key.includes("-----BEGIN")
    ? key
    : `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer);
  } else {
    throw new Error("unsupported input for base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
