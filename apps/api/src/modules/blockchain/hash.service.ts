// Hash service
// Policy hashing for blockchain verification
//
// createPolicyHash(permission):
//   1. Canonicalize permission JSON
//   2. SHA-256 hash
//   3. Store as policy_hash on-chain
//
// This lets the demo show:
//   BRAICE Database -> Permission -> Policy Hash -> Solana -> Verifiable State
