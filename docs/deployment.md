# Deploying the API to AWS ECS Fargate

`.github/workflows/ci.yml` builds the API image on every push to `main` and
deploys it. This document is the AWS half of that: what the workflow expects to
find, and what it needs in order to be allowed to use it.

The workflow owns the image and the rollout. It does not own the infrastructure.
Nothing in this repository provisions AWS — the cluster, service, task
definition, ECR repository and IAM roles are created once, by a human, and the
workflow then reads and uses them. That split is deliberate: a CI pipeline that
could create infrastructure would be able to change the thing it deploys to,
and a review of `git diff` would no longer be a review of what is about to
happen in production.

---

## 1. Repository secrets

All seven are required. Set them on the repository, or on the `production`
environment if you keep one (the workflow declares `environment: production` on
the deploy job).

| Secret | Example shape | Notes |
|---|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/<github-actions-role>` | The OIDC role. The account ID lives here and nowhere else. |
| `AWS_REGION` | `us-east-1` | Used for the ECR login and every AWS call. |
| `ECR_REPOSITORY` | `braice-api` | Repository name only — the registry (`<account>.dkr.ecr.<region>.amazonaws.com`) is read back from the ECR login step. |
| `ECS_CLUSTER` | `braice-prod` | Existing cluster. |
| `ECS_SERVICE` | `braice-api` | Existing service running a Fargate task. |
| `ECS_TASK_DEFINITION` | `braice-api` or `braice-api:42` | Existing family (or full ARN/`:revision`). The current revision is fetched and only the container image is changed. |
| `CONTAINER_NAME` | `api` | The `name` of the container inside the task definition — the one the workflow is allowed to touch. |

None of these is an AWS credential, and none of them is an application secret.
No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secret is used, read, or
supported by the workflow.

Application secrets (`DATABASE_URL`, `JWT_SECRET`, `SOLANA_*`, `AI_*`) are not
in this table on purpose. They belong in the ECS task definition as
`secretsManagerKeyRef` / `ssmParameter` entries, and they belong in AWS. The
image carries none of them and the workflow passes none of them.

---

## 2. The OIDC role

GitHub mints a short-lived JWT for the job; STS exchanges it for credentials
that die with the job. Nothing long-lived exists in GitHub.

**Trust policy** — the `sub` condition is what stops another repository from
assuming this role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-providers/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<owner>/<repo>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

The OIDC provider must exist in the account first:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

### Permissions the role needs

Scoped to the resources it actually touches. Replace the ARNs.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PushImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteMultipartUpload",
        "ecr:InitiateMultipartUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:<region>:<account-id>:repository/braice-api"
    },
    {
      "Sid": "PullImage",
      "Effect": "Allow",
      "Action": ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
      "Resource": "arn:aws:ecr:<region>:<account-id>:repository/braice-api"
    },
    {
      "Sid": "RenderAndRegisterTaskDefinition",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:DescribeTaskDefinitionRevision"
      ],
      "Resource": "*"
    },
    {
      "Sid": "UpdateAndObserveService",
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:ListTasks"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ReadExecutionRole",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": "arn:aws:iam::<account-id>:role/<ecs-task-execution-role>",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" }
      }
    }
  ]
}
```

`ecr:DescribeRepositories` is worth adding if the ECR login step ever needs to
create the repository rather than find it. `ecs:DescribeTaskDefinition` is
unscannable by resource in a useful way (the API requires `*`), which is why it
sits alone with the other task-definition actions.

---

## 3. What the workflow expects the task definition to contain

Read this as a contract, not a template to apply blindly — the workflow fetches
the live task definition and replaces exactly one field in it.

| Field | Requirement | Why |
|---|---|---|
| `family` | matches `ECS_TASK_DEFINITION` | so the fetched revision is the one that gets re-registered |
| `requiresCompatibilities` | contains `FARGATE` | Fargate task |
| `networkMode` | `awsvpc` | Fargate requirement; also needs a subnet and security group |
| `containerDefinitions[].name` | equals `CONTAINER_NAME` | the render step fails if it matches nothing |
| `containerDefinitions[].image` | any value | it is overwritten with the `${GITHUB_SHA}` tag every deploy |
| `containerDefinitions[].portMappings` | must match `PORT` | the image serves `PORT`, default 3001 |
| `containerDefinitions[].secrets` | holds `DATABASE_URL`, `JWT_SECRET`, … | the only place application credentials belong |
| `containerDefinitions[].healthCheck` | recommended | independent of the image's own `HEALTHCHECK` |
| `executionRoleArn` / `taskRoleArn` | existing roles | the workflow only re-uses them |
| `cpu` / `memory` | Fargate-valid combination | `cpu` must be a valid multiple for `memory` |

Minimum sensible shape:

```jsonc
{
  "family": "braice-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",                    // == CONTAINER_NAME
      "image": "…:bootstrap",           // replaced on every deploy
      "portMappings": [{ "containerPort": 3001, "protocol": "tcp" }],
      "environment": [
        // Non-secret settings only. PORT must match portMappings.
        { "name": "NODE_ENV",  "value": "production" },
        { "name": "PORT",      "value": "3001" },
        { "name": "FRONTEND_URL", "value": "https://…" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:…:secret:braice/db:DATABASE_URL::" },
        { "name": "JWT_SECRET",   "valueFrom": "arn:aws:secretsmanager:…:secret:braice/jwt:JWT_SECRET::" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 45
      }
    }
  ]
}
```

### Why `/api/health` and not something stricter

It answers `200` while Postgres is down and reports `status: "degraded"` in the
body. That is the intended design of the endpoint (see
`apps/api/src/common/health.controller.ts`): a database blip should not cause
Fargate to restart a process that is serving correctly. Treat `degraded` as an
alert, not as a reason to kill the task.

---

## 4. Database migrations

They are in the image at `/database/migrations` — the path
`apps/api/src/scripts/migrate.ts` resolves relative to `dist/scripts`. They are
deliberately **not** run on container start: an image that mutates the schema
on boot makes every task definition revision a migration trigger.

Run them once per release, as a one-off task:

```bash
aws ecs run-task \
  --cluster <cluster> \
  --task-definition <task-definition:revision> \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[…],securityGroups=[…]}' \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/scripts/migrate.js"]}]}'
```

---

## 5. Rolling back

Every image is tagged with the commit SHA, so a rollback is a redeploy of a tag
that already exists and is still in ECR:

```bash
aws ecs update-service --cluster <cluster> --service <service> \
  --task-definition <task-definition-family>:<revision-of-the-good-one>
```

`latest` exists for humans looking at the ECR console. No task definition
should ever reference it: it moves, and a task definition that names a moving
tag cannot be told what it is actually running.

---

## 6. What this repository does *not* do

* It does not provision anything. No CloudFormation, Terraform or CDK.
* It does not run migrations.
* It does not build the Solana program. `anchor build` is verified in CI only;
  deploying the program to devnet is a separate, deliberate act.
* It does not store credentials. There are none to store.