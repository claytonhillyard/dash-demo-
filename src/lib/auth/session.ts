import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

export async function createSession(user: string, secret: string): Promise<string> {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(secret));
}

export async function verifySession(
  token: string,
  secret: string
): Promise<{ user: string } | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: [ALG] });
    return typeof payload.user === "string" ? { user: payload.user } : null;
  } catch {
    return null;
  }
}
