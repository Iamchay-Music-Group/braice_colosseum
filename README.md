# BRAICE — Community Governance Permission Infrastructure

## What is BRAICE?

BRAICE is a permission infrastructure that proves one thing:

**Community governance decisions can control what AI and applications are technically allowed to do with community data.**

This is not fully a community platform for now. This is not a traditional access control system. BRAICE is the layer that sits between data and applications, enforcing governance-derived authorization policies.

### The Problem

Communities generate valuable behavioral data — interests, preferences, activity patterns. Currently, this data is either:
- Locked away with no controlled access, or
- Exposed directly to anyone who requests it

There is no mechanism for communities to govern how their collective intelligence is used.

### The BRAICE Solution

BRAICE creates a permission infrastructure where:

```
Community generates activity
        ↓
BRAICE aggregates into community intelligence
        ↓
Partner requests access
        ↓
Community governance evaluates the request
        ↓
Governance decision becomes a machine-readable permission
        ↓
AI/Application can only access what the permission allows
        ↓
Community can revoke access at any time
```

The permission is not a database flag. It is an enforceable authorization policy that controls what applications can technically do.

---

## Core Concepts

### Permission Engine (The Heart)

Every data access request goes through the Permission Engine. It checks:
- **Who** is requesting (principal)
- **What** data they want (resource)
- **Why** they want it (purpose)
- **How** they will use it (operation)
- **For how long** (expiration)
- **Under what conditions** (aggregation level, individual data blocked)

If any check fails, access is denied.

### Data Separation

BRAICE maintains a strict boundary:
- **Individual activity records** — Never exposed to partners or AI
- **Community-level intelligence** — Aggregated percentages only

The aggregation pipeline transforms 1,000 individual records into something like:
```json
{
  "streetwear": 42,
  "music_festivals": 31,
  "sneakers": 27,
  "beauty": 18
}
```

No member names. No emails. No individual activity. Just community-level trends.

### Governance → Permission

Governance is not just voting. It is the process that creates enforceable permissions:
- Creator approves
- Community threshold met (e.g., 60%)
- Decision becomes a machine-readable permission
- Permission is recorded on Solana for verifiable state

### Revocation

The community can revoke access at any time. When revoked:
- Permission status changes to REVOKED
- Every subsequent access attempt is denied
- Revocation is recorded on Solana

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BRAICE SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  Community   │───▶│  Activity   │───▶│ Aggregation │         │
│  │  Members     │    │  Records    │    │  Pipeline   │         │
│  └─────────────┘    └─────────────┘    └──────┬──────┘         │
│                                                │                 │
│                                                ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │    Partner  │───▶│   Access    │───▶│  Community  │         │
│  │   Request    │    │   Request   │    │ Intelligence│         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  GOVERNANCE ENGINE                       │   │
│  │  Creator Approval + Community Threshold = Decision       │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  PERMISSION ENGINE                       │   │
│  │  WHO + WHAT + WHY + HOW + DURATION + CONDITIONS         │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                     │
│              ┌─────────────┴─────────────┐                     │
│              ▼                           ▼                     │
│  ┌─────────────────┐         ┌─────────────────┐               │
│  │  AI Gateway     │         │  Partner API    │               │
│  │  (Permission-   │         │  (Permission-   │               │
│  │   aware tools)  │         │   checked)      │               │
│  └────────┬────────┘         └────────┬────────┘               │
│           │                           │                         │
│           ▼                           ▼                         │
│  ┌─────────────────┐         ┌─────────────────┐               │
│  │  LLM Response   │         │  Dataset        │               │
│  │  (Insight)      │         │  (Authorized)   │               │
│  └─────────────────┘         └─────────────────┘               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    SOLANA LAYER                          │   │
│  │  Governance Decisions │ Permission States │ Revocations  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The Flow

1. **Community generates activity** — Members interact, creating individual-level data
2. **Aggregation** — BRAICE aggregates into community intelligence (percentages)
3. **Partner requests access** — Submits request with purpose and operation
4. **Governance evaluates** — Creator approves + community threshold met
5. **Permission created** — Machine-readable authorization policy
6. **AI analyzes** — AI agent uses permission-aware tools to access authorized data
7. **Insight returned** — AI produces insight from community intelligence
8. **Revocation** — Community revokes permission
9. **Access denied** — Subsequent attempts are blocked

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend API | NestJS + TypeScript | REST API, business logic, authorization |
| Database | PostgreSQL | Persistent storage for all entities |
| Blockchain | Solana + Anchor | Verifiable governance/permission state |
| AI | LLM (OpenAI / NVIDIA Build / Ollama) | Community intelligence analysis |
| Package Manager | pnpm | Monorepo workspace management |
| Container | Docker | Local database setup |

---

## Local Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 18.0.0 | JavaScript runtime |
| pnpm | ≥ 8.0.0 | Package manager |
| Docker | ≥ 20.10.0 | Database container |
| Rust | ≥ 1.70.0 | Solana/Anchor (optional) |
| Solana CLI | ≥ 1.16.0 | Solana devnet (optional) |

### Step 1: Install System Dependencies

#### macOS

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@18

# Install pnpm
npm install -g pnpm

# Install Docker Desktop
brew install --cask docker

# (Optional) Install Rust for Solana
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# (Optional) Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

#### Linux (Ubuntu/Debian)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo systemctl start docker
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect

# (Optional) Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# (Optional) Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

#### Windows

```powershell
# Install Node.js (download from https://nodejs.org)
# Choose LTS version 18.x or higher

# Install pnpm
npm install -g pnpm

# Install Docker Desktop (download from https://docker.com/products/docker-desktop)
# Enable WSL 2 backend if prompted

# (Optional) Install Rust
# Download from https://rustup.rs

# (Optional) Install Solana CLI
# Download from https://docs.solanalabs.com/cli/install
```

### Step 2: Clone and Install

```bash
# Clone the repository
git clone git@github.com:Iamchay-Music-Group/braice_colosseum_bend.git
cd braice_colosseum_bend

# Install all dependencies (monorepo)
pnpm install
```

### Step 3: Start Database

```bash
# Start PostgreSQL in Docker
docker-compose up -d

# Verify it's running
docker ps
# You should see braice-postgres running on port 5432
```

### Step 4: Configure Environment

```bash
# Create environment file
cp .env.example .env

# Generate the one value you must supply yourself:
openssl rand -base64 48

# Paste it into JWT_SECRET. The API refuses to boot without a >= 32 character
# value, so a weak or missing key is a startup error rather than a runtime
# surprise. Everything else has a working local default.
```

**.env defaults for local development:**
```
NODE_ENV=development
PORT=3001

DATABASE_URL=postgresql://braice:braice_secret@localhost:5433/braice_db

# REQUIRED — no default. openssl rand -base64 48
JWT_SECRET=
JWT_TTL_SECONDS=900

PASSWORD_MAX_ATTEMPTS=10
PASSWORD_LOCKOUT_SECONDS=900
PASSWORD_SCRYPT_COST=15

# Off by default. A wallet is an on-chain anchoring attribute, not a login.
WALLET_AUTH_ENABLED=false
NONCE_TTL_SECONDS=300
AUTH_DOMAIN=BRAICE

SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=

AI_PROVIDERS=openai,nvidia,ollama
AI_API_KEY=
AI_MODEL=gpt-4
NVIDIA_API_KEY=
NVIDIA_MODEL=openai/gpt-oss-20b
OLLAMA_MODEL=
OLLAMA_BASE_URL=

FRONTEND_URL=http://localhost:3000
```

### Step 5: Run Migrations

```bash
# Create all database tables
pnpm db:migrate
```

### Step 6: Seed Demo Data

```bash
# Generate demo data (100 members, 1000 activity records)
pnpm seed
```

### Step 7: Start the API

```bash
# Start development server
pnpm dev
```

The API will be running at `http://localhost:3001/api`

### Step 8: Verify Setup

```bash
# Test the API
curl http://localhost:3001/api/health

# You should see:
# {"status":"ok","timestamp":"..."}
```

---

## Project Structure

```
braice_colosseum_bend/
│
├── apps/
│   └── api/                              # NestJS Backend API
│       ├── src/
│       │   ├── main.ts                   # Application entry point
│       │   ├── app.module.ts             # Root module
│       │   │
│       │   ├── config/                   # Configuration modules
│       │   │   ├── configuration.ts      # Config loader
│       │   │   ├── database.config.ts    # PostgreSQL settings
│       │   │   ├── solana.config.ts      # Solana settings
│       │   │   ├── ai.config.ts          # LLM settings
│       │   │   └── app.config.ts         # App settings
│       │   │
│       │   ├── common/                   # Shared utilities
│       │   │   ├── decorators/           # Custom decorators
│       │   │   ├── filters/              # Exception filters
│       │   │   ├── guards/               # Auth guards
│       │   │   ├── interceptors/         # Request interceptors
│       │   │   └── interfaces/           # TypeScript interfaces
│       │   │
│       │   └── modules/                  # Feature modules
│       │       ├── users/                # User management
│       │       ├── communities/          # Community CRUD
│       │       ├── memberships/          # Community membership
│       │       ├── activity/             # Individual activity (PROTECTED)
│       │       ├── datasets/             # Aggregation pipeline
│       │       ├── access-requests/      # Partner access requests
│       │       ├── governance/           # Governance engine
│       │       ├── permissions/          # Permission engine (CORE)
│       │       ├── authorization/        # Authorization gateway
│       │       ├── ai/                   # AI integration
│       │       ├── audit/                # Audit trail
│       │       └── blockchain/           # Solana integration
│       │
│       └── test/                         # Tests
│           ├── unit/                     # Unit tests
│           └── integration/              # Integration tests
│
├── packages/                             # Shared libraries
│   ├── types/                            # TypeScript type definitions
│   ├── permission-engine/                # Core permission evaluation
│   ├── governance-engine/                # Core governance evaluation
│   ├── blockchain-client/                # Solana client wrapper
│   └── ai-client/                        # LLM client wrapper
│
├── programs/                             # Solana programs
│   └── braice-governance/
│       └── src/
│           ├── state/                    # On-chain state accounts
│           └── instructions/             # Program instructions
│
├── database/
│   ├── migrations/                       # SQL schema migrations
│   ├── seeds/                            # Demo data seeds
│   └── fixtures/                         # Test fixtures
│
├── scripts/                              # Utility scripts
│   ├── seed-demo.ts                      # Generate demo data
│   ├── generate-activity.ts              # Generate activity records
│   └── deploy-devnet.ts                  # Deploy to Solana devnet
│
├── docker-compose.yml                    # PostgreSQL container
├── package.json                          # Root package.json
├── pnpm-workspace.yaml                   # Monorepo config
└── tsconfig.base.json                    # Base TypeScript config
```

---

## API Endpoints

### Authentication
Email + password is the credential. Solana is not a credential — a wallet is
only an on-chain anchoring attribute, and attaching one requires proving
control of the private key.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create account (always `MEMBER`) and sign in |
| POST | /api/auth/login | Exchange email + password for a JWT |
| GET | /api/auth/me | Current account from the token |
| POST | /api/auth/password | Rotate own password (needs current one) |
| POST | /api/auth/wallet/challenge | Issue a challenge to prove wallet ownership |
| POST | /api/auth/wallet/link | Attach a proven wallet to the caller's account |

Optional wallet sign-in, off unless `WALLET_AUTH_ENABLED=true`. It only
authenticates a wallet that is **already linked** to an account — it can never
create one.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/nonce | Request challenge (requires flag) |
| POST | /api/auth/verify | Sign nonce (requires flag, linked wallet only) |

### Users
Read-only. There is no `POST /api/users` — the old version was
unauthenticated and accepted an arbitrary `userType`, so anyone could
self-register as a `CREATOR`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | List users |
| GET | /api/users/:id | Get user |
| GET | /api/users/wallet/:address | Get user by linked wallet |

### Community
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/communities | Create community |
| GET | /api/communities/:id | Get community |
| GET | /api/communities/:id/members | List members |

### Activity (Internal Only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/communities/:id/activity | Ingest activity |

### Datasets
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/communities/:id/datasets/generate | Generate dataset |
| GET | /api/datasets/:id | Get dataset |

### Access Requests
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/access-requests | Create request |
| GET | /api/access-requests/:id | Get request |

### Governance
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/access-requests/:id/governance/approve | Approve |
| POST | /api/access-requests/:id/governance/reject | Reject |

### Permissions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/authorize | Check authorization |
| GET | /api/permissions/:id | Get permission |
| POST | /api/permissions/:id/revoke | Revoke permission |

### AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/ai/query | Ask AI question |

### AI Provider Chain

The model is optional. With none configured, `/api/ai/query` answers from the
authorized aggregate and reports `answerSource: "deterministic"` — permission
enforcement is the product and does not depend on a model being reachable.

`AI_PROVIDERS` is an ordered chain, tried left to right:

| Provider | Credential | Default model | Where it runs |
|----------|-----------|---------------|---------------|
| `openai` | `AI_API_KEY` | `gpt-4` | OpenAI |
| `nvidia` | `NVIDIA_API_KEY` | `openai/gpt-oss-20b` | NVIDIA Build (hosted) |
| `ollama` | none required | *must be set* | A local daemon |

```bash
AI_PROVIDERS=openai,nvidia,ollama
AI_API_KEY=sk-...
NVIDIA_API_KEY=nvapi-...
OLLAMA_MODEL=gpt-oss:20b      # required to enable the local tier
OLLAMA_BASE_URL=http://localhost:11434/v1
```

Notes:

- **Ollama is a deliberate opt-in.** Naming it in `AI_PROVIDERS` is not enough;
  `OLLAMA_MODEL` must be set. Without that guard a shared `.env` could put a
  machine's local daemon on the request path, and could let it outrank a paid
  provider, just because someone listed it.
- **The same model, two hosts.** `openai/gpt-oss-20b` on NVIDIA Build and
  `gpt-oss:20b` on Ollama are the same open-weight checkpoint, so a community can
  compare the two answers directly instead of comparing two different models.
- **Failover is automatic and rate-limited.** A provider that fails is skipped
  for `AI_FAILOVER_COOLDOWN_SECONDS` (default 60) rather than retried on every
  request, so a failing provider costs one round trip per cooldown window
  instead of one per request. It is offered a trial again afterwards and resumes
  automatically if it has recovered.
- **Failover triggers:** 401, 403, 429, 5xx, and connection/timeout faults. A
  400 does not — the request itself is malformed, so every provider would reject
  it identically, and paying three more round trips to learn that is pure
  latency.
- **Credentials are per-provider**, which is why a 401 on one is a reason to
  move on: it says nothing about the health of the next.
- `GET /api/health` reports `aiProvider`, `aiModel`, and `aiFailover`, so a
  silent failover is visible rather than inferred from changed answers.
- Every answer records `answerProvider` and `answerModel` in the audit trail. A
  deterministic answer records neither, so a model is never named for text it
  did not write.

### Audit
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/communities/:id/audit | Get audit trail |

---

## Key Security Rules

1. **Never trust the client** — All authorization happens server-side
2. **Roles are never self-assigned** — `POST /api/auth/register` always creates
   a `MEMBER`; roles move only through governance
3. **Passwords are stored as scrypt digests** — `password_hash` is
   `select: false`, so it is never loaded outside the login path
4. **Lockout state is private** — `failed_login_attempts` and `locked_until` are
   also `select: false`; publishing them would tell an attacker how many guesses
   remain
5. **AI has no database access** — Only permission-aware tools
6. **Activity records are protected** — Never exposed to partners or AI
7. **Blockchain is for verification** — Not the primary database, and not a
   credential. A grant whose principal has no linked wallet is still fully
   enforceable off-chain; it is simply not anchored.

---

## Testing

```bash
# Run unit tests
pnpm test

# Run all tests with coverage
pnpm test:cov

# Static checks (both are enforced in CI)
pnpm lint
pnpm typecheck
```

### Security Tests

The following must fail with appropriate errors:
- Partner accessing individual activity records → 403
- AI requesting member data → DENIED
- Expired permission access → DENIED
- Revoked permission access → DENIED
- Wrong purpose access → DENIED
- Wrong operation access → DENIED

---

## Demo Flow

The hackathon demo follows this exact sequence:

1. **Show community** — Afrobeat Creators with 100 members
2. **Show data** — 1,000 individual activities
3. **Show aggregation** — Community intelligence percentages
4. **Partner request** — Nike requests access for campaign planning
5. **Governance** — Creator approves, community threshold met
6. **Permission** — Machine-readable permission created
7. **AI analysis** — AI answers community questions
8. **Access denied** — AI cannot access individual data
9. **Revocation** — Community revokes permission
10. **Denied again** — AI access blocked

---

## Documentation

- `docs/architecture.md` — System architecture
- `docs/permission-model.md` — Permission model deep dive
- `docs/governance-model.md` — Governance rules
- `docs/demo-script.md` — Demo presentation script

---

## License

MIT

---

## Acknowledgments

Built for the Colosseum Hackathon. Inspired by the BRAICE product concept for portable community state and governance-derived permissions.
