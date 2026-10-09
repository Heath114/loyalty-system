import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import forge from 'node-forge'
import type { PassConfig } from '../config.ts'

export type PassFiles = Record<string, Uint8Array>

interface Signer {
  cert: forge.pki.Certificate
  key: forge.pki.PrivateKey
  wwdr: forge.pki.Certificate
}

const signers = new WeakMap<PassConfig, Signer>()

function signer(cfg: PassConfig): Signer {
  let s = signers.get(cfg)
  if (!s) {
    const key = cfg.keyPassphrase
      ? forge.pki.decryptRsaPrivateKey(cfg.keyPem, cfg.keyPassphrase)
      : forge.pki.privateKeyFromPem(cfg.keyPem)
    if (!key) throw new Error('Could not read the pass private key (wrong passphrase?)')
    s = { key, cert: forge.pki.certificateFromPem(cfg.certPem), wwdr: forge.pki.certificateFromPem(cfg.wwdrPem) }
    signers.set(cfg, s)
  }
  return s
}

/** Detached PKCS#7 signature of manifest.json, signed by the Pass Type ID certificate. */
export function signManifest(cfg: PassConfig, manifest: Uint8Array): Uint8Array {
  const { cert, key, wwdr } = signer(cfg)
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(Buffer.from(manifest).toString('binary'))
  p7.addCertificate(wwdr)
  p7.addCertificate(cert)
  p7.addSigner({
    key: key as forge.pki.rsa.PrivateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  })
  p7.sign({ detached: true })
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')
}

/** Zips pass.json, images and localisations with manifest.json and its signature. */
export function packPass(cfg: PassConfig, files: PassFiles): Uint8Array {
  const manifest: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) {
    manifest[name] = createHash('sha1').update(data).digest('hex')
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  return zipSync({ ...files, 'manifest.json': manifestBytes, signature: signManifest(cfg, manifestBytes) }, { level: 6 })
}
