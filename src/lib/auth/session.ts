import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

export interface SessionPayload {
  user: string;
  orgId: number;
}

export async function createSession(
  user: string,
  orgId: number,
  secret: string,
): Promise<string> {
  return new SignJWT({ user, orgId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: [ALG] });
    if (typeof payload.user !== "string") return null;
    if (
      typeof payload.orgId !== "number" ||
      !Number.isInteger(payload.orgId) ||
      payload.orgId < 1
    ) {
      return null;
    }
    return { user: payload.user, orgId: payload.orgId };
  } catch {
    return null;
  }
}
