import { Injectable } from '@nestjs/common';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

/**
 * Ed25519 signature verification for Solana wallets.
 *
 * Solana wallets sign arbitrary UTF-8 messages with an ed25519 keypair, so
 * verification is: decode the base58 signature, decode the base58 public key,
 * and check the detached signature over the exact message bytes.
 *
 * We deliberately do NOT use @solana/web3.js here. The RPC connection is a
 * blockchain concern; message verification is pure cryptography, and keeping
 * it separate means the auth path has no network dependency at all.
 */
@Injectable()
export class SignatureService {
  /**
   * Build the exact bytes a wallet must sign.
   *
   * The nonce and wallet are both embedded, plus an issued-at timestamp and
   * domain. Including the domain prevents a signature harvested from another
   * service (or another BRAICE environment) from being replayed here.
   */
  buildMessage(params: {
    walletAddress: string;
    nonce: string;
    domain: string;
    issuedAt: Date;
  }): string {
    return [
      `${params.domain} wants you to sign in with your Solana wallet:`,
      params.walletAddress,
      '',
      `Nonce: ${params.nonce}`,
      `Issued At: ${params.issuedAt.toISOString()}`,
    ].join('\n');
  }

  /**
   * Verify a detached ed25519 signature.
   *
   * Returns false rather than throwing on malformed input: a bad base58
   * string or a wrong-length key is a failed verification, not a server error.
   */
  verify(message: string, signatureB58: string, walletAddress: string): boolean {
    let signature: Uint8Array;
    let publicKey: Uint8Array;

    try {
      signature = bs58.decode(signatureB58);
      publicKey = bs58.decode(walletAddress);
    } catch {
      return false;
    }

    if (signature.length !== nacl.sign.signatureLength) {
      return false;
    }
    if (publicKey.length !== nacl.sign.publicKeyLength) {
      return false;
    }

    // Solana wallets sign the UTF-8 bytes of the message string, so the
    // encoding here must match what the wallet used or every check fails.
    const messageBytes = new TextEncoder().encode(message);

    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  }

  /**
   * Solana public keys are exactly 32 bytes. Reject anything else early so a
   * malformed address fails as a validation error, not deep inside verify().
   */
  isValidPublicKey(walletAddress: string): boolean {
    try {
      return bs58.decode(walletAddress).length === 32;
    } catch {
      return false;
    }
  }
}
