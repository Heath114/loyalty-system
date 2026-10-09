/**
 * Makes a throwaway signing setup for local development and tests: a stand-in "WWDR" CA and a pass
 * certificate it issued. Passes signed with these build and verify, but an iPhone will refuse them;
 * for a real device use the Pass Type ID certificate from developer.apple.com (see docs/APPLE_SETUP.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import forge from 'node-forge'

export function makeDevCerts(passTypeId = 'pass.dev.loyalty', teamId = 'DEVTEAM000') {
  const pki = forge.pki
  const caKeys = pki.rsa.generateKeyPair(2048)
  const ca = pki.createCertificate()
  ca.publicKey = caKeys.publicKey
  ca.serialNumber = '01'
  ca.validity.notBefore = new Date(Date.now() - 86400e3)
  ca.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400e3)
  const caName = [{ name: 'commonName', value: 'Development WWDR stand-in' }]
  ca.setSubject(caName)
  ca.setIssuer(caName)
  ca.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }])
  ca.sign(caKeys.privateKey, forge.md.sha256.create())

  const keys = pki.rsa.generateKeyPair(2048)
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '02'
  cert.validity.notBefore = ca.validity.notBefore
  cert.validity.notAfter = ca.validity.notAfter
  cert.setSubject([
    { name: 'commonName', value: `Pass Type ID: ${passTypeId}` },
    { shortName: 'OU', value: teamId },
    { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
  ])
  cert.setIssuer(caName)
  cert.sign(caKeys.privateKey, forge.md.sha256.create())

  return {
    wwdrPem: pki.certificateToPem(ca),
    certPem: pki.certificateToPem(cert),
    keyPem: pki.privateKeyToPem(keys.privateKey),
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = makeDevCerts()
  mkdirSync('certs', { recursive: true })
  writeFileSync('certs/dev-wwdr.pem', c.wwdrPem)
  writeFileSync('certs/dev-pass.pem', c.certPem)
  writeFileSync('certs/dev-pass.key', c.keyPem, { mode: 0o600 })
  console.log('Wrote certs/dev-wwdr.pem, certs/dev-pass.pem, certs/dev-pass.key')
  console.log('Use them with PASS_TYPE_ID=pass.dev.loyalty APPLE_TEAM_ID=DEVTEAM000 (see .env.example).')
}
