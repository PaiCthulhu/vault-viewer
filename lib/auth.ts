import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import type { JWTPayload } from '@/types'

export const COOKIE_NAME = 'vault_session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days in seconds

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET não definido em .env.local')
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return {
      userId: payload.userId as number,
      username: payload.username as string,
      isAdmin: payload.isAdmin as boolean,
    }
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
