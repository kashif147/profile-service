const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey() {
  const raw = process.env.PAYMENT_FORM_ENCRYPTION_KEY || "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptField(plain) {
  if (plain == null || plain === "") return { value: null, encrypted: false };
  const key = getKey();
  if (!key) {
    return { value: String(plain), encrypted: false };
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    value: Buffer.concat([iv, tag, enc]).toString("base64"),
    encrypted: true,
  };
}

function decryptField(stored) {
  if (stored == null || stored === "") return null;
  if (typeof stored === "object" && stored.encrypted === false) {
    return stored.value;
  }
  const payload =
    typeof stored === "object" && stored.value != null ? stored.value : stored;
  const key = getKey();
  if (!key) return typeof payload === "string" ? payload : null;
  const buf = Buffer.from(String(payload), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

module.exports = { encryptField, decryptField };
