import { dbGetUserByUsername, dbCreateUser } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

async function seed() {
  const username = process.argv[2] ?? 'admin'
  const password = process.argv[3] ?? 'admin123'

  const existing = dbGetUserByUsername(username)
  if (existing) {
    console.log(`Usuário "${username}" já existe (id=${existing.id})`)
    process.exit(0)
  }

  const hash = await hashPassword(password)
  const user = dbCreateUser(username, hash, true)
  console.log(`Admin criado: id=${user.id} username=${user.username}`)
  console.log(`Senha: ${password}  ← troque após o primeiro login`)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
